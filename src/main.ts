import { cwd } from "node:process";
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
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
  console.error("  npm run compare -- <prevSnapshotOrDir> <currSnapshotOrDir>");
  console.error("  npm run list");
  process.exit(1);
}

function reportPaths(version: string): { markdownPath: string; jsonPath: string } {
  return {
    markdownPath: join(ROOT_DIR, "reports", `${version}.md`),
    jsonPath: join(ROOT_DIR, "reports", `${version}.json`),
  };
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
  const snapshotVersions = getSavedSnapshotDirs(ROOT_DIR)
    .map((dir) => basename(dir))
    .sort(compareVersions);
  const reportsDir = join(ROOT_DIR, "reports");
  const markdownReports = existsSync(reportsDir)
    ? readdirSync(reportsDir)
        .filter((name) => name.endsWith(".md"))
        .map((name) => basename(name, ".md"))
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
      console.log(`- ${version}`);
    }
  }
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
  const paths = reportPaths(report.version);
  console.log(`Saved report: ${paths.markdownPath}`);
  console.log(`Saved JSON: ${paths.jsonPath}`);
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
      console.log(`Snapshot dir: ${join(ROOT_DIR, "snapshots", signals.version)}`);
      console.log("Run another `npm run track` after a new release, or compare snapshots with `npm run compare -- <prev> <curr>`.");
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
    const paths = reportPaths(report.version);
    console.log(`Saved report: ${paths.markdownPath}`);
    console.log(`Saved JSON: ${paths.jsonPath}`);
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
      resolveSnapshotOrDir(args[0]),
      resolveSnapshotOrDir(args[1]),
    );
    return;
  }

  if (command === "list") {
    printList();
    return;
  }

  usage();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
