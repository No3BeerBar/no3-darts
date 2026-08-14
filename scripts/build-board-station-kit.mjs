#!/usr/bin/env node
/**
 * Package Board Station kit into public/ for download from the live app.
 *
 * Layout (siblings - matches companion_dir: "../autodarts-companion"):
 *   START-HERE.txt
 *   board-station/   (scripts + ready config.yaml for Board 1)
 *   autodarts-companion/
 *
 * Outputs:
 *   public/board-station-kit/          unpacked mirror
 *   public/board-station-board1.zip    one-file download
 */

import {
  cpSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, crc32 } from "node:zlib";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "board-station-kit");
const ZIP_PATH = join(ROOT, "public", "board-station-board1.zip");
const BOARD_SRC = join(ROOT, "tools", "board-station");
const COMPANION_SRC = join(ROOT, "tools", "autodarts-companion");

const SKIP_NAMES = new Set([
  ".gitignore",
  ".venv",
  "__pycache__",
  ".pytest_cache",
  ".DS_Store",
  "config.yaml", // we write a ready Board 1 config
]);

const START_HERE = `No. 3 Board Station - Board 1 (mini-PC kit)
=============================================

Preferred: on the mini-PC, download and double-click (single file - no extra .ps1):
  https://no3-darts-production.up.railway.app/Board1-Setup.bat

Something wrong later? Double-click Board1-FixMe.bat in this folder
(or download https://no3-darts-production.up.railway.app/Board1-FixMe.bat).

Manual (if you already unzipped this kit):
1. Install Python 3 if needed (https://www.python.org/downloads/ - check "Add to PATH")
2. Edit board-station\\config.yaml -> set autodarts.exe_path for THIS PC
3. Double-click board-station\\start-board.bat
4. iPad: https://no3-darts-production.up.railway.app/play?room=Board%201

TV: https://no3-darts-production.up.railway.app/tv
Staff PIN (default): 1234
`;

const CONFIG_YAML = `# Board station config - Board 1 (production)
# Double-click start-board.bat to bring up the stack.

# Autodarts Board Manager (detector)
autodarts:
  host: "127.0.0.1"
  port: 3180
  # TODO: set this on the mini-PC before first run. Examples:
  #   "C:\\\\Program Files\\\\Autodarts\\\\Autodarts.exe"
  #   "C:\\\\Users\\\\Public\\\\Desktop\\\\Autodarts.lnk"
  exe_path: ""
  process_names:
    - "Autodarts"
    - "autodarts"
    - "AutodartsDesktop"
  start_if_missing: true
  # :3180 HTTP 200 is not detecting. Press Autodarts Start if Stopped.
  start_board_if_stopped: true
  ready_timeout_s: 45
  # Autodarts board UUID from Board Manager Config (Board1 only).
  # Leave blank on this one-board mini-PC.
  board_id: ""

# No3 scoring UI (Railway production)
no3:
  url: "https://no3-darts-production.up.railway.app"
  room_id: "Board 1"
  camera_api_key: ""

# Companion bridge (sibling folder - do not move without updating this)
bridge:
  enabled: true
  companion_dir: "../autodarts-companion"

# Kiosk / displays
kiosk:
  enabled: true
  browser: "msedge"
  open_tv: true
  tv_url: "{no3.url}/tv"
  open_play: false
  play_url: "{no3.url}/play"
  extra_args: "--autoplay-policy=no-user-gesture-required"
  tv_display: 1

health:
  enabled: true
  fps_min: 5.0
  unhealthy_seconds: 15.0
  restart_cooldown_seconds: 60.0
  # Only when No3 match is absent / leg-or-match boundary (not mid-visit)
  between_games_recal: true

# Companion starts a stopped board (idle timer / leftover Stop) while it is up.
keep_alive:
  enabled: true
  interval_s: 10.0
  start_cooldown_s: 30.0
  board_id: ""
`;

function shouldSkip(name) {
  if (SKIP_NAMES.has(name)) return true;
  if (name.endsWith(".pyc")) return true;
  return false;
}

/**
 * Windows PowerShell 5.1 / cmd.exe choke on UTF-8 punctuation in .ps1/.bat.
 * Also keep README/yaml/py kit text ASCII so nothing reintroduces smart punctuation.
 */
const ASCII_KIT_EXT = new Set([
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

function assertAsciiKitText(dir) {
  const bad = [];
  for (const file of listFiles(dir)) {
    const lower = file.name.toLowerCase();
    const dot = lower.lastIndexOf(".");
    const ext = dot >= 0 ? lower.slice(dot) : "";
    const base = lower.split("/").pop() || lower;
    if (!ASCII_KIT_EXT.has(ext) && base !== "start-here.txt") {
      continue;
    }
    const data = readFileSync(file.abs);
    for (let i = 0; i < data.length; i++) {
      if (data[i] > 127) {
        bad.push(file.name);
        break;
      }
    }
  }
  if (bad.length) {
    console.error(
      "Non-ASCII bytes in board-station kit text (PS 5.1 / reintroduction risk):",
    );
    for (const name of bad) console.error(`  - ${name}`);
    process.exit(1);
  }
}

function assertAsciiString(label, text) {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) {
      console.error(`Non-ASCII in ${label} at index ${i}: U+${text.charCodeAt(i).toString(16)}`);
      process.exit(1);
    }
  }
}

function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (shouldSkip(entry.name)) continue;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyTree(from, to);
    } else if (entry.isFile()) {
      cpSync(from, to);
    }
  }
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full, base));
    } else if (entry.isFile()) {
      out.push({
        abs: full,
        name: relative(base, full).split(sep).join("/"),
      });
    }
  }
  return out;
}

/** Minimal ZIP (deflate) writer - no external deps (works in Alpine Docker). */
function writeZip(zipPath, files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const data = readFileSync(file.abs);
    const nameBuf = Buffer.from(file.name, "utf8");
    const compressed = deflateRawSync(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, compressed);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0, 14);
    cen.writeUInt32LE(crc >>> 0, 16);
    cen.writeUInt32LE(compressed.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);

  writeFileSync(zipPath, Buffer.concat([...chunks, centralBuf, end]));
}

function main() {
  if (!existsSync(BOARD_SRC) || !existsSync(COMPANION_SRC)) {
    console.error("Missing tools/board-station or tools/autodarts-companion");
    process.exit(1);
  }

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(join(OUT_DIR, "board-station"), { recursive: true });
  mkdirSync(join(OUT_DIR, "autodarts-companion"), { recursive: true });

  copyTree(BOARD_SRC, join(OUT_DIR, "board-station"));
  copyTree(COMPANION_SRC, join(OUT_DIR, "autodarts-companion"));

  assertAsciiString("START_HERE", START_HERE);
  assertAsciiString("CONFIG_YAML", CONFIG_YAML);
  writeFileSync(join(OUT_DIR, "START-HERE.txt"), START_HERE, "ascii");
  writeFileSync(join(OUT_DIR, "board-station", "config.yaml"), CONFIG_YAML, "ascii");

  // Ship Fix Me at kit root so the mini-PC keeps a local double-click recovery.
  const fixMeSrc = join(ROOT, "public", "Board1-FixMe.bat");
  if (!existsSync(fixMeSrc)) {
    console.error("Missing public/Board1-FixMe.bat (required in board-station kit)");
    process.exit(1);
  }
  cpSync(fixMeSrc, join(OUT_DIR, "Board1-FixMe.bat"));

  assertAsciiKitText(OUT_DIR);

  const files = listFiles(OUT_DIR);
  if (files.length === 0) {
    console.error("Kit is empty - aborting");
    process.exit(1);
  }

  mkdirSync(join(ROOT, "public"), { recursive: true });
  writeZip(ZIP_PATH, files);

  const zipKb = Math.round(statSync(ZIP_PATH).size / 1024);
  console.log(`Board Station kit: ${files.length} files -> ${OUT_DIR}`);
  console.log(`Zip: ${ZIP_PATH} (${zipKb} KB)`);
}

main();
