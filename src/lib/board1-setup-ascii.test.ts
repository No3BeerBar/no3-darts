/**
 * Board1-Setup / kit text must stay ASCII so Windows PowerShell 5.1 never
 * hits UTF-8 smart-quote parse errors (see scripts/build-board-station-kit.mjs).
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");

const ASCII_EXT = new Set([
  ".ps1",
  ".bat",
  ".cmd",
  ".txt",
  ".md",
  ".yaml",
  ".yml",
  ".py",
  ".json",
]);

function assertAsciiFile(rel: string) {
  const abs = join(ROOT, rel);
  expect(existsSync(abs), `missing ${rel}`).toBe(true);
  const buf = readFileSync(abs);
  for (let i = 0; i < buf.length; i++) {
    if (buf[i]! > 127) {
      throw new Error(
        `Non-ASCII in ${rel} at byte ${i}: 0x${buf[i]!.toString(16)} (PS 5.1 unsafe)`
      );
    }
  }
}

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === "__pycache__" || name === ".venv" || name === "node_modules") {
        continue;
      }
      out.push(...listFiles(abs, base));
    } else if (st.isFile()) {
      out.push(abs.slice(base.length + 1).split("\\").join("/"));
    }
  }
  return out;
}

describe("Board1 setup ASCII + PS 5.1 safety", () => {
  it("Board1-Setup.bat / .ps1 / .ps1.txt are pure ASCII", () => {
    assertAsciiFile("public/Board1-Setup.bat");
    assertAsciiFile("public/Board1-Setup.ps1");
    assertAsciiFile("public/Board1-Setup.ps1.txt");
  });

  it("Board1-Setup.bat embeds PS 5.1 pre-parse + ASCII write markers", () => {
    const bat = readFileSync(join(ROOT, "public/Board1-Setup.bat"), "utf8");
    expect(bat).toMatch(/v3 ASCII/);
    expect(bat).toMatch(/Pre-parse with PS 5\.1/);
    expect(bat).toMatch(/\[Text\.Encoding\]::ASCII/);
    expect(bat).toMatch(/___NO3_BOARD1_PS1___/);
    // No smart punctuation / emdash / curly quotes in source markers
    expect(bat).not.toMatch(/[\u2013\u2014\u2018\u2019\u201c\u201d]/);
  });

  it("board-station Start-Board.ps1 stays ASCII", () => {
    assertAsciiFile("tools/board-station/Start-Board.ps1");
    assertAsciiFile("tools/board-station/start-board.bat");
  });

  it("kit builder assertAsciiKitText still present", () => {
    const src = readFileSync(
      join(ROOT, "scripts/build-board-station-kit.mjs"),
      "utf8"
    );
    expect(src).toContain("assertAsciiKitText");
    expect(src).toContain("assertAsciiString");
    expect(src).toMatch(/PowerShell 5\.1/);
  });

  it("tools/autodarts-companion kit text files are ASCII (when present)", () => {
    const companion = join(ROOT, "tools/autodarts-companion");
    const files = listFiles(companion);
    const checked: string[] = [];
    for (const rel of files) {
      const lower = rel.toLowerCase();
      const dot = lower.lastIndexOf(".");
      const ext = dot >= 0 ? lower.slice(dot) : "";
      if (!ASCII_EXT.has(ext)) continue;
      // Skip binary-ish / generated caches already filtered
      const abs = join(companion, rel);
      const buf = readFileSync(abs);
      for (let i = 0; i < buf.length; i++) {
        if (buf[i]! > 127) {
          throw new Error(
            `Non-ASCII in tools/autodarts-companion/${rel} at ${i} (kit copy would fail)`
          );
        }
      }
      checked.push(rel);
    }
    expect(checked.length).toBeGreaterThan(10);
  });
});
