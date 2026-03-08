import { cwd } from "node:process";
import { join } from "node:path";
import { extractCommandsFromBullets, getOfficialChangelog, parseChangelogEntry } from "./changelog.js";
import { extractSignals } from "./extract.js";
import {
  compareVersions,
  copyReportArtifacts,
  fetchPackage,
  getSavedSnapshotDirs,
  loadSnapshotSource,
  saveSnapshot,
} from "./load.js";
import { buildComparisonReport, renderMarkdown } from "./report.js";

const ROOT_DIR = decodeURIComponent(new URL("..", import.meta.url).pathname);
const CHANGELOG_CACHE_PATH = join(ROOT_DIR, ".tmp", "official-changelog.md");

function usage(): never {
  console.error("Usage:");
  console.error("  npm run track -- [version]");
  console.error("  tsx src/main.ts compare <prevDir> <currDir>");
  process.exit(1);
}

async function compareDirs(prevDir: string, currDir: string): Promise<void> {
  const prevSource = loadSnapshotSource(prevDir);
  const currSource = loadSnapshotSource(currDir);
  const prevSignals = extractSignals(prevSource);
  const currSignals = extractSignals(currSource);

  const officialChangelog = await getOfficialChangelog(CHANGELOG_CACHE_PATH);
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

  const markdown = renderMarkdown(report);
  const json = JSON.stringify(report, null, 2);
  copyReportArtifacts(join(ROOT_DIR, "reports"), report.version, markdown, json);
  console.log(markdown);
}

async function track(version?: string): Promise<void> {
  const officialChangelog = await getOfficialChangelog(CHANGELOG_CACHE_PATH);
  const fetched = fetchPackage(version);

  try {
    const source = loadSnapshotSource(fetched.packageDir, version);
    const signals = extractSignals(source);
    saveSnapshot(ROOT_DIR, source, signals);

    const savedSnapshotDirs = getSavedSnapshotDirs(ROOT_DIR)
      .filter((dir) => !dir.endsWith(`/${signals.version}`))
      .sort((a, b) => compareVersions(a.split("/").pop()!, b.split("/").pop()!))
      .reverse();

    if (savedSnapshotDirs.length === 0) {
      console.log(`Saved initial snapshot for ${signals.version}`);
      return;
    }

    const prevSource = loadSnapshotSource(savedSnapshotDirs[0]);
    const prevSignals = extractSignals(prevSource);
    const officialChangelogBullets = parseChangelogEntry(officialChangelog, signals.version);
    const officialMentionedCommands = extractCommandsFromBullets(officialChangelogBullets);

    const report = buildComparisonReport({
      prevSignals,
      currSignals: signals,
      prevCliContent: prevSource.cliContent,
      currCliContent: source.cliContent,
      prevPackageFiles: prevSource.packageFiles,
      currPackageFiles: source.packageFiles,
      prevTextFileContents: prevSource.textFileContents,
      currTextFileContents: source.textFileContents,
      officialChangelogBullets,
      officialMentionedCommands,
    });

    const markdown = renderMarkdown(report);
    const json = JSON.stringify(report, null, 2);
    copyReportArtifacts(join(ROOT_DIR, "reports"), report.version, markdown, json);
    console.log(markdown);
  } finally {
    fetched.cleanup();
  }
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
      args[0].startsWith("/") ? args[0] : join(cwd(), args[0]),
      args[1].startsWith("/") ? args[1] : join(cwd(), args[1]),
    );
    return;
  }

  usage();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
