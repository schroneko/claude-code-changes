import { cwd } from "node:process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { extractCommandsFromBullets, getOfficialChangelog, parseChangelogEntry } from "./changelog.js";
import { formatCliCommandSummary, groupCliCommands } from "./cli-commands.js";
import { extractSignals } from "./extract.js";
import { saveCurrentArtifact } from "./inventory.js";
import {
  compareVersions,
  copyReportArtifacts,
  fetchPackage,
  getPublishedVersions,
  getSavedSnapshotDirs,
  loadSnapshotSource,
  saveSnapshot,
} from "./load.js";
import { buildComparisonReport, renderMarkdown } from "./report.js";

const ROOT_DIR = decodeURIComponent(new URL("..", import.meta.url).pathname);
const CHANGELOG_CACHE_PATH = join(ROOT_DIR, ".tmp", "official-changelog.md");
const STATE_DIR = join(ROOT_DIR, "state");
const LATEST_VERSION_STATE_PATH = join(STATE_DIR, "latest-version.txt");

function usage(): never {
  console.error("Usage:");
  console.error("  npm run track -- [version]");
  console.error("  npm run compare -- <prevSnapshotOrDir> <currSnapshotOrDir>");
  console.error("  npm run commands -- [versionOrSnapshotDir]");
  console.error("  npm run current -- [versionOrSnapshotDir]");
  console.error("  npm run list");
  console.error("  npm run backfill -- <fromVersion> <toVersion>");
  console.error("  npm run backfill -- --all");
  process.exit(1);
}

function reportPath(version: string): string {
  return join(ROOT_DIR, "reports", `${version}.md`);
}

function writeLatestVersionState(version: string): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(LATEST_VERSION_STATE_PATH, `${version}\n`);
}

function reportsIndexPath(): string {
  return join(ROOT_DIR, "reports", "INDEX.md");
}

function resolveSnapshotOrDir(input: string): string {
  if (input.startsWith("/")) {
    return input;
  }

  const cwdPath = join(cwd(), input);
  if (existsSync(cwdPath)) {
    return cwdPath;
  }

  const snapshotPath = join(ROOT_DIR, "snapshots", input);
  if (existsSync(snapshotPath)) {
    return snapshotPath;
  }

  return cwdPath;
}

function printList(): void {
  updateReportsIndex();
  const snapshotVersions = getSavedSnapshotDirs(ROOT_DIR)
    .map((dir) => basename(dir))
    .sort(compareVersions);
  const reportsDir = join(ROOT_DIR, "reports");
  const markdownReports = existsSync(reportsDir)
    ? readdirSync(reportsDir)
        .filter((name) => name.endsWith(".md"))
        .map((name) => basename(name, ".md"))
        .filter((name) => name !== "INDEX")
        .sort(compareVersions)
    : [];

  console.log("Snapshots:");
  if (snapshotVersions.length === 0) {
    console.log("- none");
  } else {
    for (const version of snapshotVersions) {
      console.log(`- ${version}`);
    }
  }

  console.log("");
  console.log("Reports:");
  if (markdownReports.length === 0) {
    console.log("- none");
  } else {
    for (const version of markdownReports) {
      console.log(`- ${version}${snapshotVersions.includes(version) ? "" : " [report-only]"}`);
    }
  }

  const snapshotOnly = snapshotVersions.filter((version) => !markdownReports.includes(version));
  const reportOnly = markdownReports.filter((version) => !snapshotVersions.includes(version));

  console.log("");
  console.log("Summary:");
  console.log(`- snapshots: ${snapshotVersions.length}`);
  console.log(`- reports: ${markdownReports.length}`);
  console.log(`- snapshot-only: ${snapshotOnly.length > 0 ? snapshotOnly.join(", ") : "none"}`);
  console.log(`- report-only: ${reportOnly.length > 0 ? reportOnly.join(", ") : "none"}`);
}

function updateReportsIndex(): void {
  const snapshots = getSavedSnapshotDirs(ROOT_DIR)
    .map((dir) => basename(dir))
    .sort(compareVersions);
  const reportsDir = join(ROOT_DIR, "reports");
  if (!existsSync(reportsDir)) {
    return;
  }

  const reportVersions = readdirSync(reportsDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => basename(name, ".md"))
    .filter((name) => name !== "INDEX")
    .sort(compareVersions);
  const firstReportVersion = reportVersions[0];
  const latestReportVersion = reportVersions[reportVersions.length - 1];
  const latestReports = reportVersions.slice(-10).reverse();
  const earliestReports = reportVersions.slice(0, 10);

  const lines: string[] = [];
  lines.push("# Reports Index");
  lines.push("");
  lines.push("このファイルは `reports/` の見出しです。");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Snapshots: ${snapshots.length}`);
  lines.push(`- Reports: ${reportVersions.length}`);
  lines.push(`- First snapshot: \`${snapshots[0] ?? "none"}\``);
  lines.push(`- Latest snapshot: \`${snapshots[snapshots.length - 1] ?? "none"}\``);
  lines.push(`- Current full reference: [CURRENT.md](../CURRENT.md)`);
  if (firstReportVersion) {
    const prevVersion = snapshots[snapshots.indexOf(firstReportVersion) - 1];
    lines.push(`- First comparable change: [${firstReportVersion}](./${firstReportVersion}.md) (\`${prevVersion} -> ${firstReportVersion}\`)`);
  }
  if (latestReportVersion) {
    const prevVersion = snapshots[snapshots.indexOf(latestReportVersion) - 1];
    lines.push(`- Latest comparable change: [${latestReportVersion}](./${latestReportVersion}.md) (\`${prevVersion} -> ${latestReportVersion}\`)`);
  }
  lines.push("");
  lines.push("## Where To Look");
  lines.push("");
  lines.push("- 公式 changelog より詳しく見たい場合は、各 report の `Source-Only Highlights` を見てください。");
  lines.push("- パッケージ全体の増減は `0. Package Files` を見てください。");
  lines.push("- `claude xxx` の在庫差分は `1. CLI Commands` を見てください。");
  lines.push("- slash command の在庫差分は `2. Slash Commands` を見てください。");
  lines.push("- env vars / settings / sdk surface は `3. Public Surface` を見てください。");
  lines.push("- 機能カテゴリ別の荒い整理は `4. Capability Signals` を見てください。");
  lines.push("");
  lines.push("## First Reports");
  lines.push("");
  if (earliestReports.length === 0) {
    lines.push("- none");
  } else {
    for (const version of earliestReports) {
      const prevVersion = snapshots[snapshots.indexOf(version) - 1];
      lines.push(`- [${version}](./${version}.md) (\`${prevVersion} -> ${version}\`)`);
    }
  }
  lines.push("");
  lines.push("## Latest Reports");
  lines.push("");
  if (latestReports.length === 0) {
    lines.push("- none");
  } else {
    for (const version of latestReports) {
      const prevVersion = snapshots[snapshots.indexOf(version) - 1];
      lines.push(`- [${version}](./${version}.md) (\`${prevVersion} -> ${version}\`)`);
    }
  }
  lines.push("");

  writeFileSync(reportsIndexPath(), lines.join("\n"));
}

function buildReport(
  prevSource: ReturnType<typeof loadSnapshotSource>,
  currSource: ReturnType<typeof loadSnapshotSource>,
  officialChangelog: string,
): { markdown: string; version: string } {
  const prevSignals = extractSignals(prevSource);
  const currSignals = extractSignals(currSource);
  const officialChangelogBullets = parseChangelogEntry(officialChangelog, currSignals.version);
  const officialMentionedCommands = extractCommandsFromBullets(officialChangelogBullets);

  const report = buildComparisonReport({
    prevSignals,
    currSignals,
    prevCliContent: prevSource.cliContent,
    currCliContent: currSource.cliContent,
    prevPackageFiles: prevSource.packageFiles,
    currPackageFiles: currSource.packageFiles,
    prevTextFileContents: prevSource.textFileContents,
    currTextFileContents: currSource.textFileContents,
    officialChangelogBullets,
    officialMentionedCommands,
  });

  return {
    version: report.version,
    markdown: renderMarkdown(report),
  };
}

function loadSourceForInventory(input?: string): { source: ReturnType<typeof loadSnapshotSource>; cleanup: () => void } {
  if (input) {
    const resolved = resolveSnapshotOrDir(input);
    if (existsSync(resolved)) {
      return {
        source: loadSnapshotSource(resolved),
        cleanup: () => {},
      };
    }

    const fetched = fetchPackage(input);
    return {
      source: loadSnapshotSource(fetched.packageDir, input),
      cleanup: fetched.cleanup,
    };
  }

  const savedSnapshotDirs = getSavedSnapshotDirs(ROOT_DIR);
  if (savedSnapshotDirs.length > 0) {
    return {
      source: loadSnapshotSource(savedSnapshotDirs[0]!),
      cleanup: () => {},
    };
  }

  const fetched = fetchPackage();
  return {
    source: loadSnapshotSource(fetched.packageDir),
    cleanup: fetched.cleanup,
  };
}

function printCliCommands(versionOrDir?: string): void {
  const loaded = loadSourceForInventory(versionOrDir);

  try {
    const signals = extractSignals(loaded.source);
    const groups = groupCliCommands(signals.cliCommands);
    const hiddenCount = signals.cliCommands.filter((command) => command.hidden).length;

    console.log(`Version: ${signals.version}`);
    console.log(`CLI commands: ${signals.cliCommands.length}`);
    console.log(`Hidden commands: ${hiddenCount}`);
    console.log("");

    if (groups.length === 0) {
      console.log("No CLI commands detected.");
      return;
    }

    for (const group of groups) {
      console.log(`${group.label} (${group.commands.length})`);
      for (const command of group.commands) {
        console.log(`- ${formatCliCommandSummary(command, true)}`);
      }
      console.log("");
    }
  } finally {
    loaded.cleanup();
  }
}

function saveCurrent(versionOrDir?: string): void {
  const loaded = loadSourceForInventory(versionOrDir);

  try {
    const signals = extractSignals(loaded.source);
    const path = saveCurrentArtifact(ROOT_DIR, signals);
    console.log(`Saved current reference: ${path}`);
    console.log(`CLI commands: ${signals.cliCommands.length}`);
    console.log(`Slash commands: ${signals.slashCommands.length}`);
    console.log(`Environment variables: ${signals.envVars.length}`);
    console.log(`Models: ${signals.models.length}`);
    console.log(`SDK tools: ${Object.keys(signals.tools).length}`);
  } finally {
    loaded.cleanup();
  }
}

function saveAndPrintReport(result: { markdown: string; version: string }): void {
  copyReportArtifacts(join(ROOT_DIR, "reports"), result.version, result.markdown);
  updateReportsIndex();
  console.log(result.markdown);
  console.log(`Saved report: ${reportPath(result.version)}`);
}

async function compareDirs(prevDir: string, currDir: string): Promise<void> {
  const prevSource = loadSnapshotSource(prevDir);
  const currSource = loadSnapshotSource(currDir);
  const officialChangelog = await getOfficialChangelog(CHANGELOG_CACHE_PATH);
  saveAndPrintReport(buildReport(prevSource, currSource, officialChangelog));
}

async function track(version?: string): Promise<void> {
  const officialChangelog = await getOfficialChangelog(CHANGELOG_CACHE_PATH);
  const fetched = fetchPackage(version);

  try {
    const source = loadSnapshotSource(fetched.packageDir, version);
    const signals = extractSignals(source);
    saveSnapshot(ROOT_DIR, source, signals);
    writeLatestVersionState(signals.version);
    saveCurrentArtifact(ROOT_DIR, signals);

    const savedSnapshotDirs = getSavedSnapshotDirs(ROOT_DIR)
      .filter((dir) => !dir.endsWith(`/${signals.version}`))
      .sort((a, b) => compareVersions(a.split("/").pop()!, b.split("/").pop()!))
      .reverse();

    if (savedSnapshotDirs.length === 0) {
      console.log(`Saved initial snapshot for ${signals.version}`);
      console.log(`Snapshot dir: ${join(ROOT_DIR, "snapshots", signals.version)}`);
      console.log("Run another `npm run track` after a new release, or backfill a range with `npm run backfill -- <from> <to>`.");
      return;
    }

    const prevSource = loadSnapshotSource(savedSnapshotDirs[0]);
    saveAndPrintReport(buildReport(prevSource, source, officialChangelog));
  } finally {
    fetched.cleanup();
  }
}

async function backfill(fromVersion: string, toVersion: string): Promise<void> {
  const officialChangelog = await getOfficialChangelog(CHANGELOG_CACHE_PATH);
  const publishedVersions = getPublishedVersions();
  const minVersion = compareVersions(fromVersion, toVersion) <= 0 ? fromVersion : toVersion;
  const maxVersion = compareVersions(fromVersion, toVersion) <= 0 ? toVersion : fromVersion;
  const targetVersions = publishedVersions.filter((version) =>
    compareVersions(version, minVersion) >= 0 && compareVersions(version, maxVersion) <= 0,
  );

  if (targetVersions.length === 0) {
    throw new Error(`No published versions found in range ${fromVersion}..${toVersion}`);
  }

  console.log(`Backfilling ${targetVersions.length} version(s): ${targetVersions[0]} -> ${targetVersions[targetVersions.length - 1]}`);

  let previousSource: ReturnType<typeof loadSnapshotSource> | null = null;

  for (const version of targetVersions) {
    const snapshotDir = join(ROOT_DIR, "snapshots", version);
    let currentSource: ReturnType<typeof loadSnapshotSource>;

    if (existsSync(snapshotDir)) {
      currentSource = loadSnapshotSource(snapshotDir, version);
      console.log(`Using existing snapshot: ${version}`);
    } else {
      const fetched = fetchPackage(version);
      try {
        const source = loadSnapshotSource(fetched.packageDir, version);
        const signals = extractSignals(source);
        saveSnapshot(ROOT_DIR, source, signals);
        writeLatestVersionState(version);
        saveCurrentArtifact(ROOT_DIR, signals);
        currentSource = loadSnapshotSource(join(ROOT_DIR, "snapshots", version), version);
        console.log(`Saved snapshot: ${version}`);
      } finally {
        fetched.cleanup();
      }
    }

    if (previousSource) {
      const result = buildReport(previousSource, currentSource, officialChangelog);
      copyReportArtifacts(join(ROOT_DIR, "reports"), result.version, result.markdown);
      console.log(`Built report: ${previousSource.version} -> ${currentSource.version}`);
    }

    previousSource = currentSource;
  }

  console.log("Backfill complete.");
  writeLatestVersionState(targetVersions[targetVersions.length - 1]!);
  if (previousSource) {
    saveCurrentArtifact(ROOT_DIR, extractSignals(previousSource));
  }
  updateReportsIndex();
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    usage();
  }

  if (command === "track") {
    await track(args[0]);
    return;
  }

  if (command === "compare") {
    if (args.length < 2) {
      usage();
    }
    await compareDirs(
      resolveSnapshotOrDir(args[0]),
      resolveSnapshotOrDir(args[1]),
    );
    return;
  }

  if (command === "commands") {
    printCliCommands(args[0]);
    return;
  }

  if (command === "current") {
    saveCurrent(args[0]);
    return;
  }

  if (command === "list") {
    printList();
    return;
  }

  if (command === "backfill") {
    if (args.length === 1 && args[0] === "--all") {
      const publishedVersions = getPublishedVersions();
      await backfill(publishedVersions[0]!, publishedVersions[publishedVersions.length - 1]!);
      return;
    }
    if (args.length < 2) {
      usage();
    }
    await backfill(args[0], args[1]);
    return;
  }

  usage();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
