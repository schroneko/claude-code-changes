import type { CliCommand } from "./types.js";

interface CommandContext {
  path: string;
  invocations: string[];
  hidden: boolean;
}

interface CommandMatch {
  assignedVar?: string;
  parentVar: string;
  command: string;
  optionsSource: string;
  index: number;
}

interface HelperDefinition {
  param: string;
  body: string;
  matches: CommandMatch[];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function replaceLeadingToken(command: string, replacement: string): string {
  const firstSpace = command.indexOf(" ");
  if (firstSpace === -1) {
    return replacement;
  }
  return `${replacement}${command.slice(firstSpace)}`;
}

function extractDescription(segment: string): string {
  const match = segment.match(/\.description\(\s*(["'`])([\s\S]*?)\1\s*,?\s*\)/);
  if (!match) {
    return "";
  }
  return normalizeWhitespace(match[2]);
}

function extractAliases(segment: string): string[] {
  const aliases = new Set<string>();
  for (const match of segment.matchAll(/\.alias\(\s*(["'`])([\s\S]*?)\1\s*\)/g)) {
    aliases.add(normalizeWhitespace(match[2]));
  }
  return [...aliases].sort();
}

function buildInvocations(parentInvocations: string[], command: string, aliases: string[]): string[] {
  const variants = [command, ...aliases.map((alias) => replaceLeadingToken(command, alias))];
  const invocations: string[] = [];

  for (const parentInvocation of parentInvocations) {
    for (const variant of variants) {
      invocations.push(`${parentInvocation} ${variant}`.trim());
    }
  }

  return [...new Set(invocations)];
}

function getCommandScope(cliContent: string): string {
  const start =
    cliContent.indexOf("let q = new Guq()") !== -1
      ? cliContent.indexOf("let q = new Guq()")
      : cliContent.indexOf('.name("claude")');
  const end = cliContent.indexOf("await q.parseAsync(process.argv)");
  if (start === -1 || end === -1 || end <= start) {
    return "";
  }
  return cliContent.slice(start, end);
}

function findCommandMatches(scope: string): CommandMatch[] {
  const pattern =
    /(?:\b(?:let|const|var)\s+(\w+)\s*=\s*)?(\w+)\s*\.command\(\s*(["'`])([\s\S]*?)\3(?:\s*,\s*\{([\s\S]*?)\})?\s*\)/g;
  const matches: CommandMatch[] = [];

  for (const match of scope.matchAll(pattern)) {
    matches.push({
      assignedVar: match[1],
      parentVar: match[2]!,
      command: normalizeWhitespace(match[4]!),
      optionsSource: match[5] ?? "",
      index: match.index ?? 0,
    });
  }

  return matches;
}

function findMatchingBrace(content: string, openBraceIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  let escaping = false;

  for (let index = openBraceIndex; index < content.length; index += 1) {
    const char = content[index]!;

    if (quote) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function findHelperDefinitions(cliContent: string): Map<string, HelperDefinition> {
  const helpers = new Map<string, HelperDefinition>();
  const headerPattern = /function\s+(\w+)\((\w+)\)\s*\{/g;

  for (const match of cliContent.matchAll(headerPattern)) {
    const name = match[1]!;
    const param = match[2]!;
    const openBraceIndex = (match.index ?? 0) + match[0].length - 1;
    const closeBraceIndex = findMatchingBrace(cliContent, openBraceIndex);
    if (closeBraceIndex === -1) {
      continue;
    }

    const body = cliContent.slice(openBraceIndex + 1, closeBraceIndex);
    if (!body.includes(".command(")) {
      continue;
    }

    helpers.set(name, {
      param,
      body,
      matches: findCommandMatches(body),
    });
  }

  return helpers;
}

function buildCommand(
  parent: CommandContext,
  match: CommandMatch,
  segment: string,
): { command: CliCommand; context: CommandContext } {
  const aliases = extractAliases(segment);
  const description = extractDescription(segment);
  const hidden = parent.hidden || /hidden\s*:/.test(match.optionsSource);
  const path = `${parent.path} ${match.command}`;
  const invocations = buildInvocations(parent.invocations, match.command, aliases);

  return {
    command: {
      path,
      parentPath: parent.path,
      command: match.command,
      aliases,
      invocations,
      description,
      hidden,
    },
    context: {
      path,
      invocations,
      hidden,
    },
  };
}

export function extractCliCommands(cliContent: string): CliCommand[] {
  const scope = getCommandScope(cliContent);
  if (!scope) {
    return [];
  }

  const directMatches = findCommandMatches(scope);
  const helperDefinitions = findHelperDefinitions(cliContent);
  const contexts = new Map<string, CommandContext>([
    ["q", { path: "claude", invocations: ["claude"], hidden: false }],
  ]);
  const commands: CliCommand[] = [];
  const events: Array<
    | { kind: "command"; index: number; match: CommandMatch; nextIndex: number }
    | { kind: "helper"; index: number; helperName: string; parentVar: string }
  > = directMatches.map((match, index) => ({
    kind: "command",
    index: match.index,
    match,
    nextIndex: directMatches[index + 1]?.index ?? scope.length,
  }));

  if (helperDefinitions.size > 0) {
    const helperCallPattern = new RegExp(`\\b(${[...helperDefinitions.keys()].join("|")})\\((\\w+)\\)`, "g");
    for (const match of scope.matchAll(helperCallPattern)) {
      events.push({
        kind: "helper",
        index: match.index ?? 0,
        helperName: match[1]!,
        parentVar: match[2]!,
      });
    }
  }

  events.sort((a, b) => a.index - b.index || (a.kind === "command" ? -1 : 1));

  for (const event of events) {
    if (event.kind === "command") {
      const parent = contexts.get(event.match.parentVar);
      if (!parent) {
        continue;
      }

      const segment = scope.slice(event.match.index, event.nextIndex);
      const built = buildCommand(parent, event.match, segment);
      commands.push(built.command);

      if (event.match.assignedVar) {
        contexts.set(event.match.assignedVar, built.context);
      }
      continue;
    }

    const helper = helperDefinitions.get(event.helperName);
    const parent = contexts.get(event.parentVar);
    if (!helper || !parent) {
      continue;
    }

    const localContexts = new Map<string, CommandContext>([[helper.param, parent]]);
    for (let index = 0; index < helper.matches.length; index += 1) {
      const match = helper.matches[index]!;
      const helperParent = localContexts.get(match.parentVar);
      if (!helperParent) {
        continue;
      }

      const nextIndex = helper.matches[index + 1]?.index ?? helper.body.length;
      const segment = helper.body.slice(match.index, nextIndex);
      const built = buildCommand(helperParent, match, segment);
      commands.push(built.command);

      if (match.assignedVar) {
        localContexts.set(match.assignedVar, built.context);
      }
    }
  }

  return [...new Map(commands.map((command) => [command.path, command])).values()]
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function formatCliCommandSummary(command: CliCommand, includeDescription = false): string {
  const details: string[] = [];
  if (command.hidden) {
    details.push("hidden");
  }

  const aliasInvocations = command.invocations.slice(1);
  if (aliasInvocations.length > 0) {
    details.push(`aliases: ${aliasInvocations.join(", ")}`);
  }

  if (includeDescription && command.description) {
    details.push(command.description);
  }

  if (details.length === 0) {
    return command.path;
  }

  return `${command.path} (${details.join("; ")})`;
}

export function groupCliCommands(commands: CliCommand[]): Array<{ label: string; commands: CliCommand[] }> {
  const groups = new Map<string, CliCommand[]>();

  for (const command of commands) {
    const label = command.parentPath === "claude"
      ? "Top-level"
      : command.parentPath.replace(/^claude\s+/, "");
    const group = groups.get(label) ?? [];
    group.push(command);
    groups.set(label, group);
  }

  return [...groups.entries()]
    .map(([label, groupedCommands]) => ({
      label,
      commands: groupedCommands.sort((a, b) => a.path.localeCompare(b.path)),
    }))
    .sort((a, b) => {
      if (a.label === "Top-level") return -1;
      if (b.label === "Top-level") return 1;
      return a.label.localeCompare(b.label);
    });
}
