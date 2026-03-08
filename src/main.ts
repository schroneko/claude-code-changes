import { cwd } from "node:process";
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { extractCommandsFromBullets, getOfficialChangelog, parseChangelogEntry } from "./changelog.js";
import { extractSignals } from "./extract.js";
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

function usage(): never {
  console.error("Usage:");
  console.error("  npm run track -- [version]");
  console.error("  npm run compare -- <prevSnapshotOrDir> <currSnapshotOrDir>");
  console.error("  npm run list");
  console.error("  npm run backfill -- <fromVersion> <toVersion>");
  console.error("  npm run backfill -- --all");
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

function buildReport(
  prevSource: ReturnType<typeof loadSnapshotSource>,
  currSource: ReturnType<typeof loadSnapshotSource>,
  officialChangelog: string,
): { markdown: string; json: string; version: string } {
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
    json: JSON.stringify(report, null, 2),
  };
}

function saveAndPrintReport(result: { markdown: string; json: string; version: string }): void {
  copyReportArtifacts(join(ROOT_DIR, "reports"), result.version, result.markdown, result.json);
  console.log(result.markdown);
  const paths = reportPaths(result.version);
  console.log(`Saved report: ${paths.markdownPath}`);
  console.log(`Saved JSON: ${paths.jsonPath}`);
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
        currentSource = loadSnapshotSource(join(ROOT_DIR, "snapshots", version), version);
        console.log(`Saved snapshot: ${version}`);
      } finally {
        fetched.cleanup();
      }
    }

    if (previousSource) {
      const result = buildReport(previousSource, currentSource, officialChangelog);
      copyReportArtifacts(join(ROOT_DIR, "reports"), result.version, result.markdown, result.json);
      console.log(`Built report: ${previousSource.version} -> ${currentSource.version}`);
    }

    previousSource = currentSource;
  }

  console.log("Backfill complete.");
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
