import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";

const CHANGELOG_URL = "https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md";

export async function getOfficialChangelog(cachePath: string): Promise<string> {
  mkdirSync(dirname(cachePath), { recursive: true });
  try {
    const response = await fetch(CHANGELOG_URL);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const markdown = await response.text();
    writeFileSync(cachePath, markdown);
    return markdown;
  } catch {
    try {
      const markdown = execFileSync("curl", ["-L", CHANGELOG_URL], {
        encoding: "utf-8",
      });
      writeFileSync(cachePath, markdown);
      return markdown;
    } catch {
      // fall through to cache lookup
    }
    if (existsSync(cachePath)) {
      return readFileSync(cachePath, "utf-8");
    }
    return "";
  }
}

export function parseChangelogEntry(markdown: string, version: string): string[] {
  const heading = `## ${version}`;
  const lines = markdown.split("\n");
  const startIndex = lines.findIndex((line) => line.trim() === heading);
  if (startIndex === -1) {
    return [];
  }

  const bullets: string[] = [];
  let current = "";
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("## ")) {
      break;
    }
    if (line.startsWith("- ")) {
      if (current) {
        bullets.push(current.trim());
      }
      current = line.slice(2).trim();
      continue;
    }
    if (current && line.trim() !== "") {
      current += ` ${line.trim()}`;
    }
  }
  if (current) {
    bullets.push(current.trim());
  }
  return bullets;
}

export function extractCommandsFromBullets(bullets: string[]): string[] {
  const commands = new Set<string>();
  const pattern = /\/[a-z][a-z0-9:-]*/g;

  for (const bullet of bullets) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(bullet)) !== null) {
      commands.add(match[0]);
    }
  }

  return [...commands].sort();
}
