/**
 * Board1-Setup / Board1-FixMe / kit text must stay ASCII so Windows PowerShell
 * 5.1 never hits UTF-8 smart-quote parse errors.
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

  it("Board1-FixMe.bat / .ps1 are pure ASCII + recovery markers", () => {
    assertAsciiFile("public/Board1-FixMe.bat");
    assertAsciiFile("public/Board1-FixMe.ps1");
    assertAsciiFile("public/Board1-FixMe.ps1.txt");
    const bat = readFileSync(join(ROOT, "public/Board1-FixMe.bat"), "utf8");
    expect(bat).toContain("___NO3_BOARD1_FIXME_PS1___");
    expect(bat).toContain("takeout-ready");
    expect(bat).toContain("PHOTO THIS WINDOW");
    expect(bat).toMatch(/\[Text\.Encoding\]::ASCII/);
    // Zip-only fallback kill parity with embedded Fix Me
    expect(bat).toMatch(/No3-Board1-\(Setup\|FixMe\)/);
    expect(bat).toContain("companion\\\\__main__\\.py");
    expect(bat).toMatch(/TV kiosk/i);
  });

  it("Board1-FixMe.bat embed matches Board1-FixMe.ps1 exactly", () => {
    const bat = readFileSync(join(ROOT, "public/Board1-FixMe.bat"), "utf8");
    const ps1 = readFileSync(join(ROOT, "public/Board1-FixMe.ps1"), "utf8");
    const txt = readFileSync(join(ROOT, "public/Board1-FixMe.ps1.txt"), "utf8");
    const marker = "___NO3_BOARD1_FIXME_PS1___";
    const norm = (s: string) => {
      let n = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      // Drop trailing empty lines from CRLF split artifacts
      while (n.endsWith("\n\n")) n = n.slice(0, -1);
      if (!n.endsWith("\n")) n += "\n";
      return n;
    };
    const lines = norm(bat).split("\n");
    // last element is "" because of final \n — ignore for marker search
    const idx = lines.findIndex((l) => l === marker);
    expect(idx).toBeGreaterThanOrEqual(0);
    const embedded = lines.slice(idx + 1).join("\n");
    const embeddedNorm = embedded.endsWith("\n") ? embedded : embedded + "\n";
    // slice after marker includes trailing "" from split → trim to single final \n
    const embeddedClean = embeddedNorm.replace(/\n+$/, "\n");
    expect(embeddedClean).toBe(norm(ps1));
    expect(norm(txt)).toBe(norm(ps1));
    expect(ps1).toContain("Test-No3LeftoverCommand");
    expect(ps1).toContain("[/\\\\]tv(\\?|#|\\s|$)");
    // Stale companion on disk must not skip Refresh-Kit (seat-lock / 409s)
    expect(ps1).toContain("Refreshing kit from production (always)");
    expect(ps1).toMatch(/Refresh-Kit\s*\n/);
    expect(ps1).not.toMatch(
      /if \(Test-KitOk\) \{\s*\n\s*Write-Host "  Kit looks OK/
    );
    expect(ps1).toContain("expectedPlayerIndex");
    expect(ps1).toContain("Test-CompanionVenvHealthy");
    expect(ps1).toContain("missing/broken");
  });

  it("Board1-Setup.bat embeds PS 5.1 pre-parse + ASCII write markers", () => {
    const bat = readFileSync(join(ROOT, "public/Board1-Setup.bat"), "utf8");
    expect(bat).toMatch(/v3 ASCII/);
    expect(bat).toMatch(/Pre-parse with PS 5\.1/);
    expect(bat).toMatch(/\[Text\.Encoding\]::ASCII/);
    expect(bat).toMatch(/___NO3_BOARD1_PS1___/);
    expect(bat).not.toMatch(/[\u2013\u2014\u2018\u2019\u201c\u201d]/);
  });

  it("board-station Start-Board.ps1 stays ASCII", () => {
    assertAsciiFile("tools/board-station/Start-Board.ps1");
    assertAsciiFile("tools/board-station/start-board.bat");
  });

  it("Start-Board recreates a dead companion venv before pip", () => {
    const src = readFileSync(
      join(ROOT, "tools/board-station/Start-Board.ps1"),
      "utf8"
    );
    expect(src).toContain("function Test-VenvPythonRuns");
    expect(src).toContain("function New-CompanionVenv");
    expect(src).toContain("py -3 -m venv --clear .venv");
    expect(src).toContain("python -m venv --clear .venv");
    expect(src).toContain("print('ok')");
    expect(src).toContain("import sys");
    expect(src).toContain("Delete C:\\No3Darts\\Board1\\autodarts-companion\\.venv");
    expect(src).toContain("re-run Board1-FixMe.bat");
    expect(src).toMatch(/Assert-VenvPythonRunnable \$Py/);
    // Must not create on a leftover tree without --clear
    expect(src).not.toMatch(/python -m venv \.venv\s*$/m);
  });

  it("Start-Board load-config is not a false dead-venv after pip", () => {
    const src = readFileSync(
      join(ROOT, "tools/board-station/Start-Board.ps1"),
      "utf8"
    );
    expect(src).toContain("function Invoke-VenvPythonCapture");
    expect(src).toContain("function Receive-PythonPath");
    expect(src).toContain("Start-Process");
    expect(src).toContain("RedirectStandardOutput");
    expect(src).toContain("RedirectStandardError");
    expect(src).toContain("Out-Host");
    expect(src).toContain("Failed to load config");
    expect(src).toContain("load-config.py / PyYAML / config.yaml");
    expect(src).toContain("Missing load-config.py");
    expect(src).toContain("python.exe Test-Path=");
    expect(src).toMatch(/Test-VenvPythonRuns \$py "print\('ok'\)"/);
    expect(src).toMatch(/Assert-VenvPythonRunnable \$venvPy/);
    expect(src).toMatch(/Test-Path -LiteralPath \$LoadConfigPy/);
    // Dead-venv remap is a live probe, never English exception text
    expect(src).toMatch(
      /if \(-not \(Test-VenvPythonRuns \$venvPy "import sys"\)\)/
    );
    expect(src).toMatch(
      /if \(-not \(Test-VenvPythonRuns \$Py "import sys"\)\)/
    );
    expect(src).not.toContain("function Test-IsDeadVenvInvokeError");
    expect(src).not.toMatch(
      /\$cfgJson = & \$venvPy \$LoadConfigPy \$ConfigPath \| Out-String/
    );
    expect(src).not.toMatch(
      /\$_\.Exception\.Message -match ["']not recognized/
    );
  });

  it("kit ships load-config.py and Fix Me requires it after refresh", () => {
    expect(existsSync(join(ROOT, "tools/board-station/load-config.py"))).toBe(
      true
    );
    expect(
      existsSync(
        join(ROOT, "public/board-station-kit/board-station/load-config.py")
      )
    ).toBe(true);
    const zip = readFileSync(join(ROOT, "public/board-station-board1.zip"));
    expect(zip.toString("utf8")).toContain("board-station/load-config.py");
    const ps1 = readFileSync(join(ROOT, "public/Board1-FixMe.ps1"), "utf8");
    expect(ps1).toContain("board-station\\load-config.py");
    const bat = readFileSync(join(ROOT, "public/Board1-FixMe.bat"), "utf8");
    expect(bat).toContain("board-station\\load-config.py");
  });

  it("BOARD1-QA documents load-config probes after pip success", () => {
    const qa = readFileSync(join(ROOT, "docs/BOARD1-QA.md"), "utf8");
    expect(qa).toMatch(/pip install printed OK/i);
    expect(qa).toContain("load-config.py");
    expect(qa).toContain("print('ok')");
    expect(qa).toContain(
      "dir C:\\No3Darts\\Board1\\autodarts-companion\\.venv\\Scripts\\python.exe"
    );
  });

  it("Board1-FixMe does not preserve a dead companion .venv", () => {
    const ps1 = readFileSync(join(ROOT, "public/Board1-FixMe.ps1"), "utf8");
    expect(ps1).toContain("function Test-CompanionVenvHealthy");
    expect(ps1).toContain("Scripts\\python.exe");
    expect(ps1).toContain("import sys");
    expect(ps1).toContain(
      "Companion .venv python.exe missing/broken - not preserving"
    );
    expect(ps1).toContain(
      "Restored .venv python.exe is broken - deleting so start-board recreates it"
    );
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

  it("tools/autodarts-companion kit text files are ASCII", () => {
    const companion = join(ROOT, "tools/autodarts-companion");
    const files = listFiles(companion);
    const checked: string[] = [];
    for (const rel of files) {
      const lower = rel.toLowerCase();
      const dot = lower.lastIndexOf(".");
      const ext = dot >= 0 ? lower.slice(dot) : "";
      if (!ASCII_EXT.has(ext)) continue;
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
