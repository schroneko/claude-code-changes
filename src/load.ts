import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import type { ExtractedSignals, SnapshotSource } from "./types.js";

const ROOT_DIR = decodeURIComponent(new URL("..", import.meta.url).pathname);

function getOxfmtBin(): string | null {
  const local = join(ROOT_DIR, "node_modules", ".bin", "oxfmt");
  return existsSync(local) ? local : null;
}

function normalizeCli(cliContent: string): string {
  const oxfmtBin = getOxfmtBin();
  if (!oxfmtBin) {
    return cliContent;
  }

  const tempDir = mkdtempSync(join(tmpdir(), "cc-important-"));
  const tempFile = join(tempDir, "cli.js");
  writeFileSync(tempFile, cliContent);

  const result = spawnSync(oxfmtBin, [tempFile, "--write"], {
    encoding: "utf-8",
    timeout: 600000,
  });
  if (result.status !== 0) {
    rmSync(tempDir, { recursive: true, force: true });
    return cliContent;
  }

  const formatted = readFileSync(tempFile, "utf-8");
  rmSync(tempDir, { recursive: true, force: true });
  return formatted;
}

function detectVersion(sourceDir: string): string {
  const packageJsonPath = join(sourceDir, "package.json");
  if (existsSync(packageJsonPath)) {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version?: string };
    if (pkg.version) {
      return pkg.version;
    }
  }
  return basename(sourceDir);
}

function detectBuildTime(cliContent: string): string {
  const match = cliContent.match(/BUILD_TIME:"([^"]+)"/);
  return match ? match[1] : "";
}

export function loadSnapshotSource(sourceDir: string, versionOverride?: string): SnapshotSource {
  const cliPath = join(sourceDir, "cli.js");
  const cliGzPath = join(sourceDir, "cli-formatted.js.gz");
  const sdkPath = join(sourceDir, "sdk-tools.d.ts");

  if (!existsSync(sdkPath)) {
    throw new Error(`sdk-tools.d.ts not found in ${sourceDir}`);
  }

  let cliContent = "";
  if (existsSync(cliPath)) {
    cliContent = normalizeCli(readFileSync(cliPath, "utf-8"));
  } else if (existsSync(cliGzPath)) {
    cliContent = gunzipSync(readFileSync(cliGzPath)).toString("utf-8");
  } else {
    throw new Error(`cli.js or cli-formatted.js.gz not found in ${sourceDir}`);
  }

  const version = versionOverride ?? detectVersion(sourceDir);
  const buildTime = detectBuildTime(cliContent);
  const sdkContent = readFileSync(sdkPath, "utf-8");

  return {
    version,
    buildTime,
    sourceDir,
    cliContent,
    sdkContent,
  };
}

export function fetchPackage(version?: string): { packageDir: string; cleanup: () => void } {
  const tempRoot = mkdtempSync(join(tmpdir(), "cc-important-fetch-"));
  const packageSpec = version
    ? `@anthropic-ai/claude-code@${version}`
    : "@anthropic-ai/claude-code";

  const packOutput = execFileSync("npm", ["pack", packageSpec], {
    cwd: tempRoot,
    encoding: "utf-8",
  }).trim();

  const tgzFile = packOutput.split("\n").pop()!;
  execFileSync("tar", ["-xzf", tgzFile], { cwd: tempRoot });

  return {
    packageDir: join(tempRoot, "package"),
    cleanup: () => rmSync(tempRoot, { recursive: true, force: true }),
  };
}

export function saveSnapshot(rootDir: string, source: SnapshotSource, signals: ExtractedSignals): string {
  const targetDir = join(rootDir, "snapshots", source.version);
  mkdirSync(targetDir, { recursive: true });

  writeFileSync(
    join(targetDir, "signals.json"),
    JSON.stringify(signals, null, 2),
  );
  writeFileSync(
    join(targetDir, "snapshot.json"),
    JSON.stringify(
      {
        version: source.version,
        buildTime: source.buildTime,
      },
      null,
      2,
    ),
  );
  writeFileSync(join(targetDir, "sdk-tools.d.ts"), source.sdkContent);
  writeFileSync(join(targetDir, "cli-formatted.js.gz"), gzipSync(source.cliContent, { level: 9 }));

  return targetDir;
}

export function getSavedSnapshotDirs(rootDir: string): string[] {
  const snapshotsDir = join(rootDir, "snapshots");
  if (!existsSync(snapshotsDir)) {
    return [];
  }

  const versions = readdirSync(snapshotsDir).filter((entry) =>
    existsSync(join(snapshotsDir, entry, "signals.json")),
  );

  return versions.sort((a, b) => compareVersions(b, a)).map((version) => join(snapshotsDir, version));
}

export function compareVersions(a: string, b: string): number {
  const aParts = a.split(".").map(Number);
  const bParts = b.split(".").map(Number);
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index += 1) {
    const diff = (aParts[index] || 0) - (bParts[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export function copyReportArtifacts(
  reportDir: string,
  version: string,
  markdown: string,
  json: string,
): void {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, `${version}.md`), markdown);
  writeFileSync(join(reportDir, `${version}.json`), json);
}
