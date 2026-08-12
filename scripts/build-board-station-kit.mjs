#!/usr/bin/env node
/**
 * Package Board Station kit into public/ for download from the live app.
 *
 * Layout (siblings — matches companion_dir: "../autodarts-companion"):
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
  ".DS_Store",
  "config.yaml", // we write a ready Board 1 config
]);

const START_HERE = `No. 3 Board Station — Board 1 (mini-PC kit)
=============================================

1. Unzip to C:\\No3Darts\\
2. Install Python 3 if needed (https://www.python.org/downloads/ — check "Add to PATH")
3. Edit board-station\\config.yaml → set autodarts.exe_path for THIS PC
   Examples:
     "C:\\\\Program Files\\\\Autodarts\\\\Autodarts.exe"
     "C:\\\\Users\\\\Public\\\\Desktop\\\\Autodarts.lnk"
4. Double-click board-station\\start-board.bat
5. iPad: https://no3-darts-production.up.railway.app/play?room=Board%201

TV (HDMI on this PC opens automatically): https://no3-darts-production.up.railway.app/tv
Staff PIN (default): 1234

Phone setup page: https://no3-darts-production.up.railway.app/board-setup
`;

const CONFIG_YAML = `# Board station config — Board 1 (production)
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
  ready_timeout_s: 45

# No3 scoring UI (Railway production)
no3:
  url: "https://no3-darts-production.up.railway.app"
  room_id: "Board 1"
  camera_api_key: ""

# Companion bridge (sibling folder — do not move without updating this)
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
  between_games_recal: true
`;

function shouldSkip(name) {
  if (SKIP_NAMES.has(name)) return true;
  if (name.endsWith(".pyc")) return true;
  return false;
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

/** Minimal ZIP (deflate) writer — no external deps (works in Alpine Docker). */
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

  writeFileSync(join(OUT_DIR, "START-HERE.txt"), START_HERE, "utf8");
  writeFileSync(join(OUT_DIR, "board-station", "config.yaml"), CONFIG_YAML, "utf8");

  const files = listFiles(OUT_DIR);
  if (files.length === 0) {
    console.error("Kit is empty — aborting");
    process.exit(1);
  }

  mkdirSync(join(ROOT, "public"), { recursive: true });
  writeZip(ZIP_PATH, files);

  const zipKb = Math.round(statSync(ZIP_PATH).size / 1024);
  console.log(`Board Station kit: ${files.length} files → ${OUT_DIR}`);
  console.log(`Zip: ${ZIP_PATH} (${zipKb} KB)`);
}

main();
