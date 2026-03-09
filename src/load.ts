import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  Dirent,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, relative } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { ExtractedSignals, PackageFileRecord, SnapshotSource } from "./types.js";

const ROOT_DIR = decodeURIComponent(new URL("..", import.meta.url).pathname);
const PACKAGE_MANIFEST_FILENAME = "package-manifest.json";
const PACKAGE_TEXT_FILES_FILENAME = "package-text-files.json.gz";
const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".d.ts",
  ".js",
  ".json",
  ".lock",
  ".md",
  ".mjs",
  ".sh",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);

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

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
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

function normalizeRelativePath(filePath: string): string {
  return filePath.split("\\").join("/");
}

function isProbablyText(filePath: string, content: Buffer): boolean {
  if (TEXT_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    return true;
  }
  for (const byte of content.subarray(0, Math.min(content.length, 1024))) {
    if (byte === 0) {
      return false;
    }
  }
  return true;
}

function walkFiles(rootDir: string, currentDir = rootDir): string[] {
  const entries = readdirSync(currentDir, { withFileTypes: true })
    .sort((a: Dirent, b: Dirent) => a.name.localeCompare(b.name));
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(rootDir, fullPath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    files.push(normalizeRelativePath(relative(rootDir, fullPath)));
  }

  return files;
}

function buildPackageArtifactsFromDirectory(sourceDir: string): {
  packageFiles: PackageFileRecord[];
  textFileContents: Record<string, string>;
} {
  const packageFiles: PackageFileRecord[] = [];
  const textFileContents: Record<string, string> = {};

  for (const filePath of walkFiles(sourceDir)) {
    const absolutePath = join(sourceDir, filePath);
    const rawContent = readFileSync(absolutePath);
    const isText = filePath === "cli.js" || filePath === "sdk-tools.d.ts" || isProbablyText(filePath, rawContent);

    if (isText) {
      const normalizedText = filePath === "cli.js"
        ? normalizeCli(rawContent.toString("utf-8"))
        : rawContent.toString("utf-8");
      textFileContents[filePath] = normalizedText;
      packageFiles.push({
        path: filePath,
        kind: "text",
        size: Buffer.byteLength(normalizedText),
        sha256: sha256(normalizedText),
      });
      continue;
    }

    packageFiles.push({
      path: filePath,
      kind: "binary",
      size: rawContent.length,
      sha256: sha256(rawContent),
    });
  }

  return { packageFiles, textFileContents };
}

function buildLegacySnapshotArtifacts(cliContent: string, sdkContent: string): {
  packageFiles: PackageFileRecord[];
  textFileContents: Record<string, string>;
} {
  return {
    packageFiles: [
      {
        path: "cli.js",
        kind: "text",
        size: Buffer.byteLength(cliContent),
        sha256: sha256(cliContent),
      },
      {
        path: "sdk-tools.d.ts",
        kind: "text",
        size: Buffer.byteLength(sdkContent),
        sha256: sha256(sdkContent),
      },
    ],
    textFileContents: {
      "cli.js": cliContent,
      "sdk-tools.d.ts": sdkContent,
    },
  };
}

function loadPackageArtifactsFromSnapshot(sourceDir: string, cliContent: string, sdkContent: string): {
  packageFiles: PackageFileRecord[];
  textFileContents: Record<string, string>;
} {
  const manifestPath = join(sourceDir, PACKAGE_MANIFEST_FILENAME);
  const textFilesPath = join(sourceDir, PACKAGE_TEXT_FILES_FILENAME);

  if (!existsSync(manifestPath)) {
    return buildLegacySnapshotArtifacts(cliContent, sdkContent);
  }

  const packageFiles = JSON.parse(readFileSync(manifestPath, "utf-8")) as PackageFileRecord[];
  const textFileContents = existsSync(textFilesPath)
    ? JSON.parse(gunzipSync(readFileSync(textFilesPath)).toString("utf-8")) as Record<string, string>
    : {};

  if (!textFileContents["cli.js"]) {
    textFileContents["cli.js"] = cliContent;
  }
  if (!textFileContents["sdk-tools.d.ts"]) {
    textFileContents["sdk-tools.d.ts"] = sdkContent;
  }

  return { packageFiles, textFileContents };
}

export function loadSnapshotSource(sourceDir: string, versionOverride?: string): SnapshotSource {
  const cliPath = join(sourceDir, "cli.js");
  const cliMjsPath = join(sourceDir, "cli.mjs");
  const cliGzPath = join(sourceDir, "cli-formatted.js.gz");
  const sdkPath = join(sourceDir, "sdk-tools.d.ts");

  let cliContent = "";
  if (existsSync(cliPath)) {
    cliContent = normalizeCli(readFileSync(cliPath, "utf-8"));
  } else if (existsSync(cliMjsPath)) {
    cliContent = normalizeCli(readFileSync(cliMjsPath, "utf-8"));
  } else if (existsSync(cliGzPath)) {
    cliContent = gunzipSync(readFileSync(cliGzPath)).toString("utf-8");
  } else {
    throw new Error(`cli.js, cli.mjs, or cli-formatted.js.gz not found in ${sourceDir}`);
  }

  const version = versionOverride ?? detectVersion(sourceDir);
  const buildTime = detectBuildTime(cliContent);
  const sdkContent = existsSync(sdkPath) ? readFileSync(sdkPath, "utf-8") : "";
  const packageArtifacts = existsSync(join(sourceDir, PACKAGE_MANIFEST_FILENAME))
    || existsSync(cliGzPath)
    ? loadPackageArtifactsFromSnapshot(sourceDir, cliContent, sdkContent)
    : buildPackageArtifactsFromDirectory(sourceDir);

  return {
    version,
    buildTime,
    sourceDir,
    cliContent,
    sdkContent,
    packageFiles: packageArtifacts.packageFiles,
    textFileContents: packageArtifacts.textFileContents,
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

export function getPublishedVersions(): string[] {
  const output = execFileSync("npm", ["view", "@anthropic-ai/claude-code", "versions", "--json"], {
    encoding: "utf-8",
  });
  const parsed = JSON.parse(output) as string[];
  return parsed.sort(compareVersions);
}

export function saveSnapshot(rootDir: string, source: SnapshotSource, signals: ExtractedSignals): string {
  const targetDir = join(rootDir, "snapshots", source.version);
  const compactTextFileContents = Object.fromEntries(
    Object.entries(source.textFileContents).filter(([filePath]) =>
      filePath !== "cli.js" && filePath !== "sdk-tools.d.ts"
    ),
  );
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
  writeFileSync(
    join(targetDir, PACKAGE_MANIFEST_FILENAME),
    JSON.stringify(source.packageFiles, null, 2),
  );
  writeFileSync(
    join(targetDir, PACKAGE_TEXT_FILES_FILENAME),
    gzipSync(JSON.stringify(compactTextFileContents), { level: 9 }),
  );

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
): void {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, `${version}.md`), markdown);
}
