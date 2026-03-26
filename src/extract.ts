import { extractCliArguments, extractCliCommands, extractCliOptions } from "./cli-commands.js";
import ts from "typescript";
import type { ExtractedSignals, SlashCommand, SnapshotSource, ToolDefinition } from "./types.js";

function extractModels(cliContent: string): string[] {
  const modelPattern = /claude-[a-z0-9.-]+/g;
  const matches = cliContent.match(modelPattern) || [];
  return [...new Set(matches)]
    .filter((model) => {
      if (model === "claude-code") return false;
      if (model.startsWith("claude-cli-")) return false;
      if (model.endsWith(".") || model.endsWith("-")) return false;
      return model.length >= 10;
    })
    .sort();
}

function extractEnvVars(cliContent: string): string[] {
  const envPattern = /CLAUDE_[A-Z][A-Z0-9_]*/g;
  return [...new Set(cliContent.match(envPattern) || [])].sort();
}

function extractSettings(cliContent: string): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  const pattern = /\{name:"([^"]+)",default:([^,}]+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(cliContent)) !== null) {
    const name = match[1];
    const rawValue = match[2];
    let parsedValue: unknown = rawValue;

    if (rawValue === "true") parsedValue = true;
    else if (rawValue === "false") parsedValue = false;
    else if (rawValue === "null") parsedValue = null;
    else if (/^-?\d+$/.test(rawValue)) parsedValue = Number.parseInt(rawValue, 10);
    else if (/^-?\d+\.\d+$/.test(rawValue)) parsedValue = Number.parseFloat(rawValue);
    else if (rawValue.startsWith('"')) parsedValue = rawValue.slice(1, -1);

    settings[name] = parsedValue;
  }

  return settings;
}

function extractTools(sdkContent: string): ToolDefinition {
  const tools: ToolDefinition = {};
  const interfacePattern = /export interface (\w+Input)\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = interfacePattern.exec(sdkContent)) !== null) {
    const name = match[1];
    const body = match[2];
    const fields: string[] = [];
    const fieldPattern = /^\s*(\w+)(\?)?:/gm;
    let fieldMatch: RegExpExecArray | null;

    while ((fieldMatch = fieldPattern.exec(body)) !== null) {
      const fieldName = fieldMatch[1];
      const optional = fieldMatch[2] === "?";
      fields.push(optional ? `${fieldName}?` : fieldName);
    }

    if (fields.length > 0) {
      tools[name] = fields;
    }
  }

  return tools;
}

function normalizeCommandName(value: string): string | null {
  const trimmed = value.trim().replace(/[)"'`,.;:]+$/, "");
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const command = trimmed.split(/\s+/)[0];
  return /^\/[a-z][a-z0-9:-]*$/.test(command) ? command : null;
}

function findNearestDescription(cliContent: string, index: number): string | undefined {
  const windowStart = Math.max(0, index - 1200);
  const window = cliContent.slice(windowStart, index);
  const matches = [...window.matchAll(/description:\s*(["'`])([\s\S]*?)\1\s*,?/g)];
  const last = matches[matches.length - 1];
  return last ? last[2].replace(/\s+/g, " ").trim() : undefined;
}

function upgradeKind(
  current: SlashCommand["kind"] | undefined,
  next: SlashCommand["kind"],
): SlashCommand["kind"] {
  const priority: Record<SlashCommand["kind"], number> = {
    plugin: 3,
    builtin: 2,
    inferred: 1,
  };
  if (!current) {
    return next;
  }
  return priority[next] > priority[current] ? next : current;
}

function getObjectProperty(
  node: ts.ObjectLiteralExpression,
  propertyName: string,
): ts.ObjectLiteralElementLike | undefined {
  return node.properties.find((property) => {
    if (!("name" in property) || !property.name) {
      return false;
    }
    if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
      return property.name.text === propertyName;
    }
    return false;
  });
}

function hasObjectProperty(node: ts.ObjectLiteralExpression, propertyName: string): boolean {
  return getObjectProperty(node, propertyName) !== undefined;
}

function getStringInitializer(node: ts.Expression): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function getObjectStringProperty(
  node: ts.ObjectLiteralExpression,
  propertyName: string,
): string | undefined {
  const property = getObjectProperty(node, propertyName);
  if (!property) {
    return undefined;
  }
  if (ts.isPropertyAssignment(property)) {
    return getStringInitializer(property.initializer);
  }
  return undefined;
}

function getObjectBooleanProperty(
  node: ts.ObjectLiteralExpression,
  propertyName: string,
): boolean | undefined {
  const property = getObjectProperty(node, propertyName);
  if (!property || !ts.isPropertyAssignment(property)) {
    return undefined;
  }
  if (property.initializer.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (property.initializer.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  return undefined;
}

function extractFallbackSlashCommands(cliContent: string): SlashCommand[] {
  const sourceFile = ts.createSourceFile(
    "cli.js",
    cliContent,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const commands = new Map<string, SlashCommand>();

  function visit(node: ts.Node): void {
    if (ts.isObjectLiteralExpression(node)) {
      const name = getObjectStringProperty(node, "name");
      const userFacingName = hasObjectProperty(node, "userFacingName");
      const userInvocable = getObjectBooleanProperty(node, "userInvocable");
      const source = getObjectStringProperty(node, "source");
      const hasLoad = hasObjectProperty(node, "load");
      const hasDescription = hasObjectProperty(node, "description");
      const hasProgressMessage = hasObjectProperty(node, "progressMessage");
      if (
        name &&
        name !== "stub" &&
        /^[a-z][a-z0-9-]*$/.test(name) &&
        !userFacingName &&
        userInvocable !== true &&
        (hasLoad || source === "builtin") &&
        (hasDescription || hasProgressMessage)
      ) {
        commands.set(`/${name}`, {
          name: `/${name}`,
          sources: ["objectNameFallback"],
          confidence: "high",
          kind: "builtin",
          description: getObjectStringProperty(node, "description"),
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...commands.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function extractSlashCommands(cliContent: string): SlashCommand[] {
  const commandSources = new Map<
    string,
    {
      sources: Set<string>;
      kind?: SlashCommand["kind"];
      description?: string;
    }
  >();
  const patterns: Array<{
    label: string;
    regex: RegExp;
    kind: SlashCommand["kind"];
    map?: (value: string) => string;
  }> = [
    {
      label: "userFacingName",
      regex: /userFacingName\(\)\s*\{\s*return\s+"([^"]+)"/g,
      kind: "builtin",
      map: (value) => `/${value}`,
    },
    {
      label: "userFacingNameArrow",
      regex: /userFacingName:\s*\([^)]*\)\s*=>\s*"([^"]+)"/g,
      kind: "builtin",
      map: (value) => `/${value}`,
    },
    {
      label: "pluginCommand",
      regex: /pluginCommand:\s*"([a-z][a-z0-9:-]*)"/g,
      kind: "plugin",
      map: (value) => `/${value}`,
    },
    {
      label: "tryItPrompt",
      regex: /tryItPrompt:\s*"Type\s+(\/[a-z][a-z0-9:-]*)/g,
      kind: "inferred",
    },
    {
      label: "tips",
      regex: /content:\s*async\s*\(\)\s*=>\s*"(?:Run|Use)\s+(\/[a-z][a-z0-9:-]*)/g,
      kind: "inferred",
    },
    {
      label: "usage",
      regex: /Usage:\s*(\/[a-z][a-z0-9:-]*)/g,
      kind: "inferred",
    },
    {
      label: "status-hint",
      regex: /·\s*(\/[a-z][a-z0-9:-]*)/g,
      kind: "inferred",
    },
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(cliContent)) !== null) {
      const rawValue = pattern.map ? pattern.map(match[1]) : match[1];
      const command = normalizeCommandName(rawValue);
      if (!command) {
        continue;
      }
      if (!commandSources.has(command)) {
        commandSources.set(command, {
          sources: new Set(),
          kind: pattern.kind,
          description: findNearestDescription(cliContent, match.index ?? 0),
        });
      }
      const entry = commandSources.get(command)!;
      entry.sources.add(pattern.label);
      entry.kind = upgradeKind(entry.kind, pattern.kind);
      if (!entry.description) {
        entry.description = findNearestDescription(cliContent, match.index ?? 0);
      }
    }
  }

  for (const fallbackCommand of extractFallbackSlashCommands(cliContent)) {
    if (!commandSources.has(fallbackCommand.name)) {
      commandSources.set(fallbackCommand.name, {
        sources: new Set(fallbackCommand.sources),
        kind: fallbackCommand.kind,
        description: fallbackCommand.description,
      });
      continue;
    }
    const entry = commandSources.get(fallbackCommand.name)!;
    for (const source of fallbackCommand.sources) {
      entry.sources.add(source);
    }
    entry.kind = upgradeKind(entry.kind, fallbackCommand.kind);
    if (fallbackCommand.description) {
      entry.description = fallbackCommand.description;
    }
  }

  return [...commandSources.entries()]
    .map(([name, entry]) => {
      const sources = [...entry.sources].sort();
      let confidence: SlashCommand["confidence"] = "low";
      if (
        sources.includes("userFacingName") ||
        sources.includes("userFacingNameArrow") ||
        sources.includes("pluginCommand") ||
        sources.includes("objectNameFallback")
      ) {
        confidence = "high";
      } else if (
        sources.includes("tryItPrompt") ||
        sources.includes("usage") ||
        sources.includes("tips")
      ) {
        confidence = "medium";
      }
      return {
        name,
        sources,
        confidence,
        kind: entry.kind ?? "inferred",
        description: entry.description,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function extractSignals(source: SnapshotSource): ExtractedSignals {
  return {
    version: source.version,
    buildTime: source.buildTime,
    cliArguments: extractCliArguments(source.cliContent),
    cliCommands: extractCliCommands(source.cliContent),
    cliOptions: extractCliOptions(source.cliContent),
    slashCommands: extractSlashCommands(source.cliContent),
    tools: extractTools(source.sdkContent),
    models: extractModels(source.cliContent),
    envVars: extractEnvVars(source.cliContent),
    settings: extractSettings(source.cliContent),
  };
}
