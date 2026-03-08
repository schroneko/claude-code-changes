import type { ChangeEntry, ComparisonReport, ExtractedSignals, ToolDefinition } from "./types.js";
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

function diffSlashCommands(prev: ExtractedSignals["slashCommands"], curr: ExtractedSignals["slashCommands"]): ChangeEntry[] {
  const prevNames = prev.map((command) => command.name);
  const currNames = curr.map((command) => command.name);
  return diffArrays(prevNames, currNames);
}

function buildSourceOnlyChanges(input: {
  slashCommands: ChangeEntry[];
  envVars: ChangeEntry[];
  settings: ChangeEntry[];
  tools: ChangeEntry[];
  officialMentionedCommands: string[];
}): ComparisonReport["sourceOnlyChanges"] {
  return {
    slashCommands: input.slashCommands.filter(
      (entry) => entry.type === "added" && !input.officialMentionedCommands.includes(entry.name),
    ),
    envVars: input.envVars,
    settings: input.settings,
    tools: input.tools,
  };
}

export function buildComparisonReport(input: {
  prevSignals: ExtractedSignals;
  currSignals: ExtractedSignals;
  prevCliContent: string;
  currCliContent: string;
  officialChangelogBullets: string[];
  officialMentionedCommands: string[];
}): ComparisonReport {
  const slashCommands = diffSlashCommands(input.prevSignals.slashCommands, input.currSignals.slashCommands);
  const models = diffArrays(input.prevSignals.models, input.currSignals.models);
  const envVars = diffArrays(input.prevSignals.envVars, input.currSignals.envVars);
  const settings = diffSettings(input.prevSignals.settings, input.currSignals.settings);
  const tools = diffTools(input.prevSignals.tools, input.currSignals.tools);
  const sourceOnlyChanges = buildSourceOnlyChanges({
    slashCommands,
    envVars,
    settings,
    tools,
    officialMentionedCommands: input.officialMentionedCommands,
  });

  const capabilitySignals = classifyCapabilitySignals({
    prevCliContent: input.prevCliContent,
    currCliContent: input.currCliContent,
    officialChangelogBullets: input.officialChangelogBullets,
    slashCommands,
    settings,
    envVars,
    tools,
  });

  return {
    version: input.currSignals.version,
    prevVersion: input.prevSignals.version,
    buildTime: input.currSignals.buildTime,
    officialChangelogBullets: input.officialChangelogBullets,
    officialMentionedCommands: input.officialMentionedCommands,
    slashCommands,
    currentSlashCommands: input.currSignals.slashCommands,
    models,
    envVars,
    settings,
    tools,
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
    lines.push(`- ${signal.label} (${signal.changeType})${signal.sourceOnly ? " [source-only]" : ""}`);
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
  const builtin = report.currentSlashCommands
    .filter((command) => command.confidence === "high" && command.kind === "builtin")
    .map((command) => command.name);
  const plugin = report.currentSlashCommands
    .filter((command) => command.confidence === "high" && command.kind === "plugin")
    .map((command) => command.name);
  const inferred = report.currentSlashCommands
    .filter((command) => command.confidence !== "high")
    .map((command) => `${command.name} [${command.kind}/${command.confidence}]`);

  const lines: string[] = [];
  if (builtin.length > 0) {
    lines.push(`Built-in (${builtin.length}): ${builtin.join(", ")}`);
  }
  if (plugin.length > 0) {
    lines.push(`Plugin-backed (${plugin.length}): ${plugin.join(", ")}`);
  }
  if (inferred.length > 0) {
    lines.push(`Inferred (${inferred.length}): ${inferred.join(", ")}`);
  }
  return lines;
}

function renderSourceOnlyHighlights(report: ComparisonReport): string[] {
  const sections: Array<{ label: string; entries: ChangeEntry[] }> = [
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
  lines.push("## 1. Slash Commands");
  lines.push("### Changes");
  lines.push(...renderChangeList(report.slashCommands, report.officialMentionedCommands));
  lines.push("");
  lines.push("### Current Inventory");
  for (const line of renderSlashCommandInventory(report)) {
    lines.push(`- ${line}`);
  }
  lines.push("");
  lines.push("## 2. Public Surface");
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
  lines.push("## 3. Capability Signals");
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
