import { formatCliCommandSummary, groupCliCommands } from "./cli-commands.js";
import type {
  ChangeEntry,
  CliArgument,
  CliCommand,
  CliOption,
  ComparisonReport,
  ExtractedSignals,
  PackageFileRecord,
  ToolDefinition,
} from "./types.js";
import { classifyCapabilitySignals } from "./taxonomy.js";

function diffArrays(prev: string[], curr: string[]): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  const prevSet = new Set(prev);
  const currSet = new Set(curr);

  for (const item of curr) {
    if (!prevSet.has(item)) {
      entries.push({ type: "added", name: item });
    }
  }
  for (const item of prev) {
    if (!currSet.has(item)) {
      entries.push({ type: "removed", name: item });
    }
  }

  return entries;
}

function diffSettings(prev: Record<string, unknown>, curr: Record<string, unknown>): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(curr)]);

  for (const key of allKeys) {
    const prevValue = prev[key];
    const currValue = curr[key];
    if (prevValue === undefined && currValue !== undefined) {
      entries.push({ type: "added", name: key, detail: String(currValue) });
    } else if (prevValue !== undefined && currValue === undefined) {
      entries.push({ type: "removed", name: key });
    } else if (JSON.stringify(prevValue) !== JSON.stringify(currValue)) {
      entries.push({
        type: "changed",
        name: key,
        detail: `${JSON.stringify(prevValue)} -> ${JSON.stringify(currValue)}`,
      });
    }
  }

  return entries;
}

function diffTools(prev: ToolDefinition, curr: ToolDefinition): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  const allTools = new Set([...Object.keys(prev), ...Object.keys(curr)]);

  for (const tool of allTools) {
    const prevFields = prev[tool];
    const currFields = curr[tool];

    if (!prevFields && currFields) {
      entries.push({ type: "added", name: tool });
      continue;
    }
    if (prevFields && !currFields) {
      entries.push({ type: "removed", name: tool });
      continue;
    }
    if (!prevFields || !currFields) {
      continue;
    }

    const prevSet = new Set(prevFields);
    const currSet = new Set(currFields);
    const added = currFields.filter((field) => !prevSet.has(field));
    const removed = prevFields.filter((field) => !currSet.has(field));

    if (added.length > 0 || removed.length > 0) {
      const details: string[] = [];
      if (added.length > 0) details.push(`+${added.join(", ")}`);
      if (removed.length > 0) details.push(`-${removed.join(", ")}`);
      entries.push({
        type: "changed",
        name: tool,
        detail: details.join("; "),
      });
    }
  }

  return entries;
}

function diffSlashCommands(
  prev: ExtractedSignals["slashCommands"],
  curr: ExtractedSignals["slashCommands"],
): ChangeEntry[] {
  const prevNames = prev.map((command) => command.name);
  const currNames = curr.map((command) => command.name);
  return diffArrays(prevNames, currNames);
}

function diffCliArguments(prev: CliArgument[], curr: CliArgument[]): ChangeEntry[] {
  return diffArrays(
    prev.map((argument) => `${argument.scopePath} ${argument.name}`),
    curr.map((argument) => `${argument.scopePath} ${argument.name}`),
  );
}

function diffCliCommands(prev: CliCommand[], curr: CliCommand[]): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  const prevMap = new Map(prev.map((command) => [command.path, command]));
  const currMap = new Map(curr.map((command) => [command.path, command]));
  const allPaths = new Set([...prevMap.keys(), ...currMap.keys()]);

  for (const path of [...allPaths].sort()) {
    const prevCommand = prevMap.get(path);
    const currCommand = currMap.get(path);

    if (!prevCommand && currCommand) {
      entries.push({
        type: "added",
        name: path,
        detail: formatCliCommandSummary(currCommand, true)
          .replace(`${currCommand.path}`, "")
          .replace(/^\s*\((.*)\)\s*$/, "$1"),
      });
      continue;
    }
    if (prevCommand && !currCommand) {
      entries.push({
        type: "removed",
        name: path,
        detail: formatCliCommandSummary(prevCommand, true)
          .replace(`${prevCommand.path}`, "")
          .replace(/^\s*\((.*)\)\s*$/, "$1"),
      });
      continue;
    }
    if (!prevCommand || !currCommand) {
      continue;
    }

    const details: string[] = [];
    if (prevCommand.hidden !== currCommand.hidden) {
      details.push(`hidden: ${prevCommand.hidden} -> ${currCommand.hidden}`);
    }

    const prevAliases = new Set(prevCommand.invocations.slice(1));
    const currAliases = new Set(currCommand.invocations.slice(1));
    const addedAliases = currCommand.invocations
      .slice(1)
      .filter((alias) => !prevAliases.has(alias));
    const removedAliases = prevCommand.invocations
      .slice(1)
      .filter((alias) => !currAliases.has(alias));
    if (addedAliases.length > 0) {
      details.push(`+aliases: ${addedAliases.join(", ")}`);
    }
    if (removedAliases.length > 0) {
      details.push(`-aliases: ${removedAliases.join(", ")}`);
    }

    if (prevCommand.description !== currCommand.description) {
      details.push("description changed");
    }

    if (details.length > 0) {
      entries.push({
        type: "changed",
        name: path,
        detail: details.join("; "),
      });
    }
  }

  return entries;
}

function diffCliOptions(prev: CliOption[], curr: CliOption[]): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  const keyOf = (option: CliOption) => `${option.scopePath}::${option.names.join("|")}`;
  const prevMap = new Map(prev.map((option) => [keyOf(option), option]));
  const currMap = new Map(curr.map((option) => [keyOf(option), option]));
  const allKeys = new Set([...prevMap.keys(), ...currMap.keys()]);

  for (const key of [...allKeys].sort()) {
    const prevOption = prevMap.get(key);
    const currOption = currMap.get(key);
    const displayName = (currOption ?? prevOption)!.names.join(", ");

    if (!prevOption && currOption) {
      entries.push({
        type: "added",
        name: `${currOption.scopePath} ${displayName}`,
        detail: currOption.description,
      });
      continue;
    }
    if (prevOption && !currOption) {
      entries.push({
        type: "removed",
        name: `${prevOption.scopePath} ${displayName}`,
        detail: prevOption.description,
      });
      continue;
    }
    if (!prevOption || !currOption) {
      continue;
    }

    const details: string[] = [];
    if (prevOption.hidden !== currOption.hidden) {
      details.push(`hidden: ${prevOption.hidden} -> ${currOption.hidden}`);
    }
    if (prevOption.description !== currOption.description) {
      details.push("description changed");
    }

    if (details.length > 0) {
      entries.push({
        type: "changed",
        name: `${currOption.scopePath} ${displayName}`,
        detail: details.join("; "),
      });
    }
  }

  return entries;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }
  return content.split("\n").length;
}

function diffPackageFiles(
  prevFiles: PackageFileRecord[],
  currFiles: PackageFileRecord[],
  prevTextFileContents: Record<string, string>,
  currTextFileContents: Record<string, string>,
): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  const prevMap = new Map(prevFiles.map((file) => [file.path, file]));
  const currMap = new Map(currFiles.map((file) => [file.path, file]));
  const allPaths = new Set([...prevMap.keys(), ...currMap.keys()]);

  for (const filePath of [...allPaths].sort()) {
    const prevFile = prevMap.get(filePath);
    const currFile = currMap.get(filePath);

    if (!prevFile && currFile) {
      entries.push({
        type: "added",
        name: filePath,
        detail: `${currFile.kind}, ${formatBytes(currFile.size)}`,
      });
      continue;
    }
    if (prevFile && !currFile) {
      entries.push({
        type: "removed",
        name: filePath,
        detail: `${prevFile.kind}, ${formatBytes(prevFile.size)}`,
      });
      continue;
    }
    if (!prevFile || !currFile || prevFile.sha256 === currFile.sha256) {
      continue;
    }

    if (prevFile.kind === "text" && currFile.kind === "text") {
      const prevLines = countLines(prevTextFileContents[filePath] ?? "");
      const currLines = countLines(currTextFileContents[filePath] ?? "");
      entries.push({
        type: "changed",
        name: filePath,
        detail: `text, ${prevLines} -> ${currLines} lines`,
      });
      continue;
    }

    entries.push({
      type: "changed",
      name: filePath,
      detail: `${prevFile.kind} ${formatBytes(prevFile.size)} -> ${currFile.kind} ${formatBytes(currFile.size)}`,
    });
  }

  return entries;
}

function buildSourceOnlyChanges(input: {
  cliArguments: ChangeEntry[];
  cliCommands: ChangeEntry[];
  cliOptions: ChangeEntry[];
  slashCommands: ChangeEntry[];
  envVars: ChangeEntry[];
  settings: ChangeEntry[];
  tools: ChangeEntry[];
  packageFiles: ChangeEntry[];
  officialMentionedCommands: string[];
}): ComparisonReport["sourceOnlyChanges"] {
  return {
    cliArguments: input.cliArguments.filter((entry) => entry.type === "added"),
    cliCommands: input.cliCommands.filter((entry) => entry.type === "added"),
    cliOptions: input.cliOptions.filter((entry) => entry.type === "added"),
    slashCommands: input.slashCommands.filter(
      (entry) => entry.type === "added" && !input.officialMentionedCommands.includes(entry.name),
    ),
    envVars: input.envVars,
    settings: input.settings,
    tools: input.tools,
    packageFiles: input.packageFiles,
  };
}

export function buildComparisonReport(input: {
  prevSignals: ExtractedSignals;
  currSignals: ExtractedSignals;
  prevCliContent: string;
  currCliContent: string;
  prevPackageFiles: PackageFileRecord[];
  currPackageFiles: PackageFileRecord[];
  prevTextFileContents: Record<string, string>;
  currTextFileContents: Record<string, string>;
  officialChangelogBullets: string[];
  officialMentionedCommands: string[];
}): ComparisonReport {
  const cliArguments = diffCliArguments(
    input.prevSignals.cliArguments,
    input.currSignals.cliArguments,
  );
  const cliCommands = diffCliCommands(input.prevSignals.cliCommands, input.currSignals.cliCommands);
  const cliOptions = diffCliOptions(input.prevSignals.cliOptions, input.currSignals.cliOptions);
  const slashCommands = diffSlashCommands(
    input.prevSignals.slashCommands,
    input.currSignals.slashCommands,
  );
  const models = diffArrays(input.prevSignals.models, input.currSignals.models);
  const envVars = diffArrays(input.prevSignals.envVars, input.currSignals.envVars);
  const settings = diffSettings(input.prevSignals.settings, input.currSignals.settings);
  const tools = diffTools(input.prevSignals.tools, input.currSignals.tools);
  const packageFiles = diffPackageFiles(
    input.prevPackageFiles,
    input.currPackageFiles,
    input.prevTextFileContents,
    input.currTextFileContents,
  );
  const sourceOnlyChanges = buildSourceOnlyChanges({
    cliArguments,
    cliCommands,
    cliOptions,
    slashCommands,
    envVars,
    settings,
    tools,
    packageFiles,
    officialMentionedCommands: input.officialMentionedCommands,
  });
  const hasAnyDetectedChange = [
    cliArguments,
    cliCommands,
    cliOptions,
    slashCommands,
    models,
    envVars,
    settings,
    tools,
    packageFiles,
  ].some((entries) => entries.length > 0);

  const capabilitySignals = hasAnyDetectedChange
    ? classifyCapabilitySignals({
        prevCliContent: input.prevCliContent,
        currCliContent: input.currCliContent,
        officialChangelogBullets: input.officialChangelogBullets,
        slashCommands,
        settings,
        envVars,
        tools,
      })
    : [];

  return {
    version: input.currSignals.version,
    prevVersion: input.prevSignals.version,
    buildTime: input.currSignals.buildTime,
    officialChangelogBullets: input.officialChangelogBullets,
    officialMentionedCommands: input.officialMentionedCommands,
    cliArguments,
    currentCliArguments: input.currSignals.cliArguments,
    cliCommands,
    currentCliCommands: input.currSignals.cliCommands,
    cliOptions,
    currentCliOptions: input.currSignals.cliOptions,
    slashCommands,
    currentSlashCommands: input.currSignals.slashCommands,
    models,
    envVars,
    settings,
    tools,
    packageFiles,
    capabilitySignals,
    sourceOnlyChanges,
  };
}

function renderChangeList(entries: ChangeEntry[], officialMentionedCommands: string[]): string[] {
  if (entries.length === 0) {
    return ["- No changes detected"];
  }

  return entries.map((entry) => {
    const detail = entry.detail ? ` (${entry.detail})` : "";
    const officialTag =
      entry.name.startsWith("/") && entry.type === "added"
        ? officialMentionedCommands.includes(entry.name)
          ? " [official]"
          : " [source-only]"
        : "";
    return `- ${entry.type.toUpperCase()}: \`${entry.name}\`${detail}${officialTag}`;
  });
}

function renderCapabilitySignals(report: ComparisonReport): string[] {
  if (report.capabilitySignals.length === 0) {
    return ["- No capability-level signals detected"];
  }

  const lines: string[] = [];
  for (const signal of report.capabilitySignals) {
    lines.push(
      `- ${signal.label} (${signal.changeType})${signal.sourceOnly ? " [source-only]" : ""}`,
    );
    for (const highlight of signal.officialHighlights.slice(0, 2)) {
      lines.push(`  - Official: ${highlight}`);
    }
    for (const highlight of signal.sourceHighlights.slice(0, 4)) {
      lines.push(`  - Source: ${highlight}`);
    }
    for (const evidence of signal.evidence.slice(0, 2)) {
      lines.push(`  - ${evidence}`);
    }
  }
  return lines;
}

function renderSlashCommandInventory(report: ComparisonReport): string[] {
  const sections: Array<{ label: string; commands: typeof report.currentSlashCommands }> = [
    {
      label: `Built-in (${report.currentSlashCommands.filter((command) => command.confidence === "high" && command.kind === "builtin").length})`,
      commands: report.currentSlashCommands.filter(
        (command) => command.confidence === "high" && command.kind === "builtin",
      ),
    },
    {
      label: `Plugin-backed (${report.currentSlashCommands.filter((command) => command.confidence === "high" && command.kind === "plugin").length})`,
      commands: report.currentSlashCommands.filter(
        (command) => command.confidence === "high" && command.kind === "plugin",
      ),
    },
    {
      label: `Inferred (${report.currentSlashCommands.filter((command) => command.confidence !== "high").length})`,
      commands: report.currentSlashCommands.filter((command) => command.confidence !== "high"),
    },
  ];

  const lines: string[] = [];
  for (const section of sections) {
    lines.push(section.label);
    if (section.commands.length === 0) {
      lines.push("  - none");
      continue;
    }
    for (const command of section.commands) {
      const detail = command.description
        ? `${command.name} - ${command.description}`
        : command.confidence !== "high"
          ? `${command.name} [${command.kind}/${command.confidence}]`
          : command.name;
      lines.push(`  - ${detail}`);
    }
  }
  return lines;
}

function renderCliCommandInventory(report: ComparisonReport): string[] {
  const groups = groupCliCommands(report.currentCliCommands);
  if (groups.length === 0) {
    return ["- No CLI commands detected"];
  }

  const hasNonHelpOptions = (path: string): boolean =>
    report.currentCliOptions.some(
      (option) => option.scopePath === path && option.names.join(", ") !== "-h, --help",
    );
  const withOptionsMarker = (command: CliCommand): string => {
    if (!hasNonHelpOptions(command.path) || command.command.includes("[options]")) {
      return formatCliCommandSummary(command);
    }

    const [firstToken, ...rest] = command.command.split(" ");
    const commandWithOptions = [firstToken, "[options]", ...rest].join(" ");
    const displayCommand: CliCommand = {
      ...command,
      path: `${command.parentPath} ${commandWithOptions}`.trim(),
      command: commandWithOptions,
    };
    return formatCliCommandSummary(displayCommand);
  };

  return groups.map(
    (group) =>
      `${group.label} (${group.commands.length}): ${group.commands.map((command) => withOptionsMarker(command)).join(", ")}`,
  );
}

function renderCliArgumentInventory(report: ComparisonReport): string[] {
  if (report.currentCliArguments.length === 0) {
    return ["- No CLI arguments detected"];
  }

  return report.currentCliArguments.map(
    (argument) => `- ${argument.scopePath} ${argument.name} - ${argument.description}`,
  );
}

function renderCliOptionInventory(report: ComparisonReport): string[] {
  if (report.currentCliOptions.length === 0) {
    return ["- No CLI options detected"];
  }

  return report.currentCliOptions.map((option) => {
    const hidden = option.hidden ? " [hidden]" : "";
    return `- ${option.scopePath} ${option.names.join(", ")}${hidden} - ${option.description}`;
  });
}

function renderSourceOnlyHighlights(report: ComparisonReport): string[] {
  const sections: Array<{ label: string; entries: ChangeEntry[] }> = [
    { label: "Package Files", entries: report.sourceOnlyChanges.packageFiles },
    { label: "CLI Arguments", entries: report.sourceOnlyChanges.cliArguments },
    { label: "CLI Commands", entries: report.sourceOnlyChanges.cliCommands },
    { label: "CLI Options", entries: report.sourceOnlyChanges.cliOptions },
    { label: "Slash Commands", entries: report.sourceOnlyChanges.slashCommands },
    { label: "Environment Variables", entries: report.sourceOnlyChanges.envVars },
    { label: "Settings", entries: report.sourceOnlyChanges.settings },
    { label: "SDK Tools", entries: report.sourceOnlyChanges.tools },
  ];

  const activeSections = sections.filter((section) => section.entries.length > 0);
  if (activeSections.length === 0) {
    return ["- No source-only highlights detected"];
  }

  const lines: string[] = [];
  for (const section of activeSections) {
    lines.push(`### ${section.label}`);
    lines.push(...renderChangeList(section.entries, report.officialMentionedCommands));
    lines.push("");
  }
  return lines;
}

export function renderMarkdown(report: ComparisonReport): string {
  const lines: string[] = [];
  lines.push(`# Claude Code ${report.version}`);
  lines.push("");
  lines.push(`Compared with \`${report.prevVersion}\``);
  if (report.buildTime) {
    lines.push(`Build time: \`${report.buildTime}\``);
  }
  lines.push("");
  lines.push("## Source-Only Highlights");
  lines.push(...renderSourceOnlyHighlights(report));
  lines.push("");
  lines.push("## 0. Package Files");
  lines.push(...renderChangeList(report.packageFiles, []));
  lines.push("");
  lines.push("## 1. CLI Commands");
  lines.push(...renderChangeList(report.cliCommands, []));
  lines.push("");
  lines.push("### CLI Arguments");
  lines.push(...renderChangeList(report.cliArguments, []));
  lines.push("");
  lines.push("### CLI Options");
  lines.push(...renderChangeList(report.cliOptions, report.officialMentionedCommands));
  lines.push("");
  lines.push("## 2. Slash Commands");
  lines.push(...renderChangeList(report.slashCommands, report.officialMentionedCommands));
  lines.push("");
  lines.push("## 3. Public Surface");
  lines.push("### Models");
  lines.push(...renderChangeList(report.models, []));
  lines.push("");
  lines.push("### Environment Variables");
  lines.push(...renderChangeList(report.envVars, []));
  lines.push("");
  lines.push("### Settings");
  lines.push(...renderChangeList(report.settings, []));
  lines.push("");
  lines.push("### SDK Tools");
  lines.push(...renderChangeList(report.tools, []));
  lines.push("");
  lines.push("## 4. Capability Signals");
  lines.push(...renderCapabilitySignals(report));
  lines.push("");
  lines.push("## Official Changelog");
  if (report.officialChangelogBullets.length === 0) {
    lines.push("- No official changelog entry found for this version");
  } else {
    for (const bullet of report.officialChangelogBullets) {
      lines.push(`- ${bullet}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
