import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatCliCommandSummary, groupCliCommands } from "./cli-commands.js";
import type { ExtractedSignals } from "./types.js";

function formatSettingsValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

export function currentPath(rootDir: string): string {
  return join(rootDir, "CURRENT.md");
}

export function renderInventoryMarkdown(signals: ExtractedSignals): string {
  const lines: string[] = [];
  const cliGroups = groupCliCommands(signals.cliCommands);
  const builtinSlash = signals.slashCommands.filter((command) => command.kind === "builtin" && command.confidence === "high");
  const pluginSlash = signals.slashCommands.filter((command) => command.kind === "plugin" && command.confidence === "high");
  const inferredSlash = signals.slashCommands.filter((command) => command.confidence !== "high");
  const toolNames = Object.keys(signals.tools).sort();
  const settingKeys = Object.keys(signals.settings).sort();

  lines.push(`# Claude Code Inventory ${signals.version}`);
  lines.push("");
  if (signals.buildTime) {
    lines.push(`Build time: \`${signals.buildTime}\``);
    lines.push("");
  }
  lines.push("## Summary");
  lines.push(`- CLI commands: ${signals.cliCommands.length}`);
  lines.push(`- Hidden CLI commands: ${signals.cliCommands.filter((command) => command.hidden).length}`);
  lines.push(`- Slash commands: ${signals.slashCommands.length}`);
  lines.push(`- Environment variables: ${signals.envVars.length}`);
  lines.push(`- Models: ${signals.models.length}`);
  lines.push(`- SDK tools: ${toolNames.length}`);
  lines.push(`- Settings: ${settingKeys.length}`);
  lines.push("");
  lines.push("## CLI Commands");
  lines.push("### Arguments");
  if (signals.cliArguments.length === 0) {
    lines.push("- none");
  } else {
    for (const argument of signals.cliArguments) {
      lines.push(`- ${argument.scopePath} ${argument.name} - ${argument.description}`);
    }
  }
  lines.push("");
  lines.push("### Options");
  if (signals.cliOptions.length === 0) {
    lines.push("- none");
  } else {
    for (const option of signals.cliOptions) {
      lines.push(`- ${option.scopePath} ${option.names.join(", ")}${option.hidden ? " [hidden]" : ""} - ${option.description}`);
    }
  }
  lines.push("");
  if (cliGroups.length === 0) {
    lines.push("- none");
  } else {
    for (const group of cliGroups) {
      lines.push(`### ${group.label} (${group.commands.length})`);
      for (const command of group.commands) {
        lines.push(`- ${formatCliCommandSummary(command, true)}`);
      }
      lines.push("");
    }
  }

  lines.push("## Slash Commands");
  lines.push(`### Built-in (${builtinSlash.length})`);
  if (builtinSlash.length === 0) {
    lines.push("- none");
  } else {
    for (const command of builtinSlash) {
      lines.push(`- ${command.name}${command.description ? ` - ${command.description}` : ""}`);
    }
  }
  lines.push("");
  lines.push(`### Plugin-backed (${pluginSlash.length})`);
  if (pluginSlash.length === 0) {
    lines.push("- none");
  } else {
    for (const command of pluginSlash) {
      lines.push(`- ${command.name}${command.description ? ` - ${command.description}` : ""}`);
    }
  }
  lines.push("");
  lines.push(`### Inferred (${inferredSlash.length})`);
  if (inferredSlash.length === 0) {
    lines.push("- none");
  } else {
    for (const command of inferredSlash) {
      const suffix = command.description
        ? ` - ${command.description}`
        : ` [${command.kind}/${command.confidence}]`;
      lines.push(`- ${command.name}${suffix}`);
    }
  }
  lines.push("");
  lines.push(`## Environment Variables (${signals.envVars.length})`);
  if (signals.envVars.length === 0) {
    lines.push("- none");
  } else {
    for (const envVar of signals.envVars) {
      lines.push(`- ${envVar}`);
    }
  }
  lines.push("");
  lines.push(`## Models (${signals.models.length})`);
  if (signals.models.length === 0) {
    lines.push("- none");
  } else {
    for (const model of signals.models) {
      lines.push(`- ${model}`);
    }
  }
  lines.push("");
  lines.push(`## SDK Tools (${toolNames.length})`);
  if (toolNames.length === 0) {
    lines.push("- none");
  } else {
    for (const toolName of toolNames) {
      lines.push(`- ${toolName}: ${signals.tools[toolName]!.join(", ")}`);
    }
  }
  lines.push("");
  lines.push(`## Settings (${settingKeys.length})`);
  if (settingKeys.length === 0) {
    lines.push("- none");
  } else {
    for (const key of settingKeys) {
      lines.push(`- ${key}: ${formatSettingsValue(signals.settings[key])}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

export function saveCurrentArtifact(rootDir: string, signals: ExtractedSignals): string {
  const path = currentPath(rootDir);
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(path, renderInventoryMarkdown(signals));
  return path;
}
