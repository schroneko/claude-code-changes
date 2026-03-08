import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import type { CapabilitySignal, ChangeEntry } from "./types.js";

const NOISE_PATTERNS = [
  /^[-+]\s*var\s+[a-zA-Z][a-zA-Z0-9]{0,4}\s*=/,
  /^[-+]\s*[a-zA-Z][a-zA-Z0-9]{0,3}\s*[=,;(\[]/,
  /^[-+]\s*\(\([a-zA-Z0-9_]+\s*=/,
  /^[-+]\s*function\s+[a-zA-Z][a-zA-Z0-9]{0,4}\(/,
  /^[-+]\s*[a-zA-Z][a-zA-Z0-9]{0,4}\s*:\s*function/,
  /^[-+]\s*}\s*,?\s*$/,
  /^[-+]\s*{\s*$/,
  /^[-+]\s*\)\s*[,;]?\s*$/,
  /^[-+]\s*\]\s*[,;]?\s*$/,
  /^[-+]\s*\/\//,
  /^[-+]\s*$/,
];

const WEAK_EVIDENCE_PATTERNS = [
  /^(case|default)\s+["'][^"']+["']:/,
  /^return\s+["'][^"']+["'];?$/,
  /^plugin(Name|Command):/,
  /^name:\s*"[^"]+"[,]?$/,
  /^description:\s*"[^"]+"[,]?$/,
  /^source:\s*"[^"]+"[,]?$/,
  /^type:\s*"[^"]+"[,]?$/,
];

const DOMAINS = [
  {
    id: "slash-and-workflows",
    label: "Slash / Workflows",
    patterns: [
      /slash command/i,
      /\/(?:resume|fork|loop|compact|clear|review|plan|rename|permissions|plugin|mcp)\b/i,
    ],
  },
  {
    id: "mcp-and-connectors",
    label: "MCP / Connectors",
    patterns: [/\bmcp\b/i, /connector/i, /oauth/i, /resource/i, /tool list/i],
  },
  {
    id: "plugins-and-marketplace",
    label: "Plugins / Marketplace",
    patterns: [/\bplugin\b/i, /marketplace/i, /reload-plugins/i, /strictKnownMarketplaces/i],
  },
  {
    id: "agents-and-skills",
    label: "Agents / Skills",
    patterns: [/\bagent\b/i, /\bteammate\b/i, /\bsubagent\b/i, /\bskill\b/i],
  },
  {
    id: "memory-and-context",
    label: "Memory / Context",
    patterns: [/\bmemory\b/i, /\bcompact\b/i, /\bcontext\b/i, /\btranscript\b/i, /\/clear\b/i],
  },
  {
    id: "permissions-and-sandbox",
    label: "Permissions / Sandbox",
    patterns: [/\bpermission/i, /\bsandbox\b/i, /\ballowlist\b/i, /\bacceptEdits\b/i, /\bbypass\b/i],
  },
  {
    id: "models-and-effort",
    label: "Models / Effort",
    patterns: [/\bmodel\b/i, /\bopus\b/i, /\bsonnet\b/i, /\beffort\b/i, /\bthink\b/i],
  },
  {
    id: "ide-ui-voice-remote",
    label: "IDE / UI / Voice / Remote",
    patterns: [/\bvscode\b/i, /\bchrome\b/i, /\bvoice\b/i, /\btheme\b/i, /\bcolor\b/i, /\bremote\b/i, /\bstatusline\b/i, /\bmobile\b/i],
  },
];

function isNoiseLine(line: string): boolean {
  return NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

function createPatch(prevContent: string, currContent: string): string {
  const tempDir = mkdtempSync(join(tmpdir(), "cc-important-diff-"));
  const prevFile = join(tempDir, "prev.js");
  const currFile = join(tempDir, "curr.js");
  writeFileSync(prevFile, prevContent);
  writeFileSync(currFile, currContent);

  const result = spawnSync("diff", ["-u", prevFile, currFile], {
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024,
  });

  rmSync(tempDir, { recursive: true, force: true });

  if (result.status !== 0 && result.status !== 1) {
    throw new Error(result.stderr || "Failed to generate patch");
  }

  return result.stdout;
}

function summarizePatchMatches(lines: string[]): string[] {
  const examples = [...new Set(
    lines
      .map((line) => line.replace(/^[-+]\s*/, "").trim())
      .filter((line) => line.length >= 12 && line.length <= 160)
      .filter((line) => !/^["'`]?\/.*\/[gimsuy]*["'`]?,?$/.test(line))
      .filter((line) => !line.includes("\\\\"))
      .filter((line) => !WEAK_EVIDENCE_PATTERNS.some((pattern) => pattern.test(line)))
      .slice(0, 12),
  )].slice(0, 2);

  return examples.map((example) => {
    if (example.includes("/")) {
      return `Command example: ${example}`;
    }
    if (/CLAUDE_|default:|setting|permission|mode/i.test(example)) {
      return `Config example: ${example}`;
    }
    return `Feature example: ${example}`;
  });
}

function formatSlashHighlights(entries: ChangeEntry[], patterns: RegExp[]): string[] {
  return entries
    .filter((entry) => patterns.some((pattern) => pattern.test(entry.name)))
    .slice(0, 4)
    .map((entry) => `Slash command ${entry.type}: ${entry.name}`);
}

function formatSurfaceHighlights(
  settings: ChangeEntry[],
  envVars: ChangeEntry[],
  tools: ChangeEntry[],
  patterns: RegExp[],
): string[] {
  const highlights: string[] = [];
  for (const entry of settings) {
    if (patterns.some((pattern) => pattern.test(entry.name))) {
      highlights.push(`Setting ${entry.type}: ${entry.name}${entry.detail ? ` (${entry.detail})` : ""}`);
    }
  }
  for (const entry of envVars) {
    if (patterns.some((pattern) => pattern.test(entry.name))) {
      highlights.push(`Env ${entry.type}: ${entry.name}`);
    }
  }
  for (const entry of tools) {
    if (patterns.some((pattern) => pattern.test(entry.name) || pattern.test(entry.detail || ""))) {
      highlights.push(`Tool ${entry.type}: ${entry.name}${entry.detail ? ` (${entry.detail})` : ""}`);
    }
  }
  return highlights.slice(0, 6);
}

function detectChangeType(added: number, removed: number): "added" | "removed" | "changed" {
  if (added > 0 && removed === 0) return "added";
  if (removed > 0 && added === 0) return "removed";
  return "changed";
}

export function classifyCapabilitySignals(input: {
  prevCliContent: string;
  currCliContent: string;
  officialChangelogBullets: string[];
  slashCommands: ChangeEntry[];
  settings: ChangeEntry[];
  envVars: ChangeEntry[];
  tools: ChangeEntry[];
}): CapabilitySignal[] {
  const patch = createPatch(input.prevCliContent, input.currCliContent);
  const addedLines = patch
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .filter((line) => !isNoiseLine(line));
  const removedLines = patch
    .split("\n")
    .filter((line) => line.startsWith("-") && !line.startsWith("---"))
    .filter((line) => !isNoiseLine(line));

  const signals: CapabilitySignal[] = [];

  for (const domain of DOMAINS) {
    const addedMatches = addedLines.filter((line) => domain.patterns.some((pattern) => pattern.test(line)));
    const removedMatches = removedLines.filter((line) => domain.patterns.some((pattern) => pattern.test(line)));
    const changelogMatches = input.officialChangelogBullets.filter((bullet) =>
      domain.patterns.some((pattern) => pattern.test(bullet)),
    );
    const slashHighlights = formatSlashHighlights(input.slashCommands, domain.patterns);
    const surfaceHighlights = formatSurfaceHighlights(
      input.settings,
      input.envVars,
      input.tools,
      domain.patterns,
    );

    if (
      addedMatches.length === 0 &&
      removedMatches.length === 0 &&
      changelogMatches.length === 0 &&
      slashHighlights.length === 0 &&
      surfaceHighlights.length === 0
    ) {
      continue;
    }

    const officialHighlights = changelogMatches.slice(0, 4);
    const sourceHighlights = [
      ...slashHighlights,
      ...surfaceHighlights,
    ];

    const evidence = [
      ...summarizePatchMatches(addedMatches),
      ...summarizePatchMatches(removedMatches),
    ].slice(0, 2);

    signals.push({
      id: domain.id,
      label: domain.label,
      changeType: detectChangeType(addedMatches.length, removedMatches.length),
      officialHighlights: [...new Set(officialHighlights)].slice(0, 4),
      sourceHighlights: [...new Set(sourceHighlights)].slice(0, 6),
      evidence,
      sourceOnly: changelogMatches.length === 0 && (sourceHighlights.length > 0 || evidence.length > 0),
    });
  }

  return signals;
}
