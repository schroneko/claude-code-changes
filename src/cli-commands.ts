import type { CliArgument, CliCommand, CliOption } from "./types.js";

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

function sanitizeDescription(value: string): string {
  return normalizeWhitespace(value)
    .replace(/\bq\.(option|addOption|helpOption)\($/, "")
    .replace(/\.(addOption|option)\($/, "")
    .trim();
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

function parseNames(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
}

function parseArguments(segment: string, scopePath: string): CliArgument[] {
  const argumentsList: CliArgument[] = [];
  const pattern = /\.argument\(\s*(["'`])([\s\S]*?)\1\s*,\s*(["'`])([\s\S]*?)\3/g;

  for (const match of segment.matchAll(pattern)) {
    const name = normalizeWhitespace(match[2]!);
    argumentsList.push({
      scopePath,
      name,
      description: sanitizeDescription(match[4]!),
      required: name.startsWith("<"),
    });
  }

  return argumentsList;
}

function parseOptions(segment: string, scopePath: string): CliOption[] {
  const options: CliOption[] = [];

  for (const match of segment.matchAll(/\.helpOption\(\s*(["'`])([\s\S]*?)\1\s*,\s*(["'`])([\s\S]*?)\3/g)) {
    options.push({
      scopePath,
      names: parseNames(match[2]!),
      description: sanitizeDescription(match[4]!),
      hidden: false,
    });
  }

  for (const match of segment.matchAll(/\.version\(\s*(["'`])[\s\S]*?\1\s*,\s*(["'`])([\s\S]*?)\2\s*,\s*(["'`])([\s\S]*?)\4/g)) {
    options.push({
      scopePath,
      names: parseNames(match[3]!),
      description: sanitizeDescription(match[5]!),
      hidden: false,
    });
  }

  for (const match of segment.matchAll(/\.option\(\s*(["'`])([\s\S]*?)\1\s*,\s*(["'`])([\s\S]*?)\3/g)) {
    options.push({
      scopePath,
      names: parseNames(match[2]!),
      description: sanitizeDescription(match[4]!),
      hidden: false,
    });
  }

  for (const match of segment.matchAll(/\.addOption\(/g)) {
    const start = match.index ?? 0;
    const candidates = [
      segment.indexOf(".addOption(", start + 1),
      segment.indexOf(".option(", start + 1),
      segment.indexOf(".command(", start + 1),
      segment.indexOf(".action(", start + 1),
      segment.indexOf(".helpOption(", start + 1),
      segment.indexOf(".version(", start + 1),
    ].filter((index) => index !== -1);
    const end = candidates.length > 0 ? Math.min(...candidates) : Math.min(segment.length, start + 1200);
    const window = segment.slice(start, end);
    const optionMatch = window.match(/new \w+\(\s*(["'`])([\s\S]*?)\1\s*,\s*(["'`])([\s\S]*?)\3/);
    if (!optionMatch) {
      continue;
    }

    options.push({
      scopePath,
      names: parseNames(optionMatch[2]!),
      description: sanitizeDescription(optionMatch[4]!),
      hidden: window.includes(".hideHelp("),
    });
  }

  return options;
}

function uniqueOptions(options: CliOption[]): CliOption[] {
  const seen = new Map<string, CliOption>();
  for (const option of options) {
    const key = `${option.scopePath}::${option.names.join("|")}`;
    if (!seen.has(key)) {
      seen.set(key, option);
    }
  }
  return [...seen.values()].sort((a, b) => {
    const scopeCompare = a.scopePath.localeCompare(b.scopePath);
    if (scopeCompare !== 0) return scopeCompare;
    return a.names.join(", ").localeCompare(b.names.join(", "));
  });
}

function uniqueArguments(argumentsList: CliArgument[]): CliArgument[] {
  const seen = new Map<string, CliArgument>();
  for (const argument of argumentsList) {
    const key = `${argument.scopePath}::${argument.name}`;
    if (!seen.has(key)) {
      seen.set(key, argument);
    }
  }
  return [...seen.values()].sort((a, b) => {
    const scopeCompare = a.scopePath.localeCompare(b.scopePath);
    if (scopeCompare !== 0) return scopeCompare;
    return a.name.localeCompare(b.name);
  });
}

function extractRootSegment(scope: string): string {
  const rootStart = scope.indexOf('.name("claude")');
  if (rootStart === -1) {
    return "";
  }

  const actionIndex = scope.indexOf(".action(async (_, $) => {", rootStart);
  const initialSegment = actionIndex === -1 ? scope.slice(rootStart) : scope.slice(rootStart, actionIndex);
  const trailingSegments: string[] = [];

  for (const match of scope.matchAll(/\bq\.(option|addOption|helpOption)\(/g)) {
    const start = match.index ?? 0;
    const candidates = [
      scope.indexOf("q.option(", start + 1),
      scope.indexOf("q.addOption(", start + 1),
      scope.indexOf("q.helpOption(", start + 1),
      scope.indexOf("q.command(", start + 1),
      scope.indexOf("await q.parseAsync(process.argv)", start + 1),
    ].filter((index) => index !== -1);
    const end = candidates.length > 0 ? Math.min(...candidates) : scope.length;
    trailingSegments.push(scope.slice(start, end));
  }

  const versionIndex = scope.indexOf(".version(", rootStart);
  if (versionIndex !== -1) {
    const candidates = [
      scope.indexOf("q.option(", versionIndex + 1),
      scope.indexOf("q.addOption(", versionIndex + 1),
      scope.indexOf("await q.parseAsync(process.argv)", versionIndex + 1),
    ].filter((index) => index !== -1);
    const end = candidates.length > 0 ? Math.min(...candidates) : Math.min(scope.length, versionIndex + 400);
    trailingSegments.push(scope.slice(versionIndex, end));
  }

  return [initialSegment, ...trailingSegments].join("\n");
}

function extractCommandSegments(cliContent: string): Array<{ command: CliCommand; segment: string }> {
  const scope = getCommandScope(cliContent);
  if (!scope) {
    return [];
  }

  const directMatches = findCommandMatches(scope);
  const helperDefinitions = findHelperDefinitions(cliContent);
  const contexts = new Map<string, CommandContext>([
    ["q", { path: "claude", invocations: ["claude"], hidden: false }],
  ]);
  const commandSegments: Array<{ command: CliCommand; segment: string }> = [];
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
      commandSegments.push({ command: built.command, segment });

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
      commandSegments.push({ command: built.command, segment });

      if (match.assignedVar) {
        localContexts.set(match.assignedVar, built.context);
      }
    }
  }

  return commandSegments;
}

export function extractCliCommands(cliContent: string): CliCommand[] {
  const commands = extractCommandSegments(cliContent).map(({ command }) => command);
  return [...new Map(commands.map((command) => [command.path, command])).values()]
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function extractCliOptions(cliContent: string): CliOption[] {
  const scope = getCommandScope(cliContent);
  if (!scope) {
    return [];
  }

  const options: CliOption[] = [];
  const rootSegment = extractRootSegment(scope);
  if (rootSegment) {
    options.push(...parseOptions(rootSegment, "claude"));
  }

  for (const { command, segment } of extractCommandSegments(cliContent)) {
    options.push(...parseOptions(segment, command.path));
  }

  return uniqueOptions(options);
}

export function extractCliArguments(cliContent: string): CliArgument[] {
  const scope = getCommandScope(cliContent);
  if (!scope) {
    return [];
  }

  const argumentsList: CliArgument[] = [];
  const rootSegment = extractRootSegment(scope);
  if (rootSegment) {
    argumentsList.push(...parseArguments(rootSegment, "claude"));
  }

  for (const { command, segment } of extractCommandSegments(cliContent)) {
    argumentsList.push(...parseArguments(segment, command.path));
  }

  return uniqueArguments(argumentsList);
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
