export interface SlashCommand {
  name: string;
  sources: string[];
  confidence: "high" | "medium" | "low";
  kind: "builtin" | "plugin" | "inferred";
  description?: string;
}

export interface CliCommand {
  path: string;
  parentPath: string;
  command: string;
  aliases: string[];
  invocations: string[];
  description: string;
  hidden: boolean;
}

export interface CliOption {
  scopePath: string;
  names: string[];
  description: string;
  hidden: boolean;
}

export interface CliArgument {
  scopePath: string;
  name: string;
  description: string;
  required: boolean;
}

export interface ToolDefinition {
  [toolName: string]: string[];
}

export interface ExtractedSignals {
  version: string;
  buildTime: string;
  cliArguments: CliArgument[];
  cliCommands: CliCommand[];
  cliOptions: CliOption[];
  slashCommands: SlashCommand[];
  tools: ToolDefinition;
  models: string[];
  envVars: string[];
  settings: Record<string, unknown>;
}

export interface PackageFileRecord {
  path: string;
  kind: "text" | "binary";
  size: number;
  sha256: string;
}

export interface SnapshotSource {
  version: string;
  buildTime: string;
  sourceDir: string;
  cliContent: string;
  sdkContent: string;
  packageFiles: PackageFileRecord[];
  textFileContents: Record<string, string>;
}

export interface ChangeEntry {
  type: "added" | "removed" | "changed";
  name: string;
  detail?: string;
}

export interface CapabilitySignal {
  id: string;
  label: string;
  changeType: "added" | "removed" | "changed";
  officialHighlights: string[];
  sourceHighlights: string[];
  evidence: string[];
  sourceOnly: boolean;
}

export interface SourceOnlyChanges {
  cliArguments: ChangeEntry[];
  cliCommands: ChangeEntry[];
  cliOptions: ChangeEntry[];
  slashCommands: ChangeEntry[];
  envVars: ChangeEntry[];
  settings: ChangeEntry[];
  tools: ChangeEntry[];
  packageFiles: ChangeEntry[];
}

export interface ComparisonReport {
  version: string;
  prevVersion: string;
  buildTime: string;
  officialChangelogBullets: string[];
  officialMentionedCommands: string[];
  cliArguments: ChangeEntry[];
  currentCliArguments: CliArgument[];
  cliCommands: ChangeEntry[];
  currentCliCommands: CliCommand[];
  cliOptions: ChangeEntry[];
  currentCliOptions: CliOption[];
  slashCommands: ChangeEntry[];
  currentSlashCommands: SlashCommand[];
  models: ChangeEntry[];
  envVars: ChangeEntry[];
  settings: ChangeEntry[];
  tools: ChangeEntry[];
  packageFiles: ChangeEntry[];
  capabilitySignals: CapabilitySignal[];
  sourceOnlyChanges: SourceOnlyChanges;
}
