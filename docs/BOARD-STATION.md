# Board station (mini-PC + iPad + TV)

Bar ops guide for **No. 3 Craft Beer Bar**: Autodarts detects throws; No3 scores and shows the match.

> DIY OpenCV under `detection/` is experimental — **not** the bar path. Prefer Autodarts Board Manager + companion bridge.

## Wiring

| Piece | Role |
|-------|------|
| **Windows mini-PC** | Autodarts Board Manager, companion bridge, optional TV browser kiosk |
| **3× USB cams + ring light** | Autodarts hardware (calibrate in Board Manager) |
| **iPad** | Player interaction — No3 `/play` (setup, undo, fix dart, end turn) |
| **TV (HDMI)** | Match view — No3 `/tv` (same mini-PC HDMI out **or** second display) |

```
[Cams] → Autodarts Board Manager :3180
              ↓ poll /api/state
        companion bridge (mini-PC)
              ↓ POST /api/camera/dart | correct | end-turn | health
        No3 server ──SSE──► iPad /play + TV /tv
```

## One-script start

On the mini-PC (repo checked out, e.g. `C:\No3Darts\no3-darts`):

1. Copy `tools/board-station/config.example.yaml` → `tools/board-station/config.yaml`
2. Edit **`autodarts.exe_path`** for *this* machine (do not leave a wrong path), plus `no3.url`, `room_id`, `camera_api_key`
3. Double-click **`tools/board-station/start-board.bat`**  
   (or `powershell -File tools\board-station\Start-Board.ps1`)

What it does:

1. Starts / waits for Autodarts Board Manager (`exe_path` + `/api/state` ready check)
2. Writes companion `config.yaml` and launches `python -m companion bridge`
3. Optionally opens Edge/Chrome **kiosk** to the TV match URL
4. Prints the **iPad play URL** (and ASCII QR when possible) — the script cannot start apps on the iPad

### Config knobs (`tools/board-station/config.yaml`)

| Key | Purpose |
|-----|---------|
| `autodarts.exe_path` | Editable Board Manager path / shortcut |
| `autodarts.host` / `port` | Local API (default `127.0.0.1:3180`) |
| `no3.url` / `room_id` / `camera_api_key` | No3 target + room |
| `kiosk.open_tv` / `browser` / `tv_url` | TV kiosk window |
| `kiosk.open_play` | Usually `false` — use the iPad |
| `health.*` | FPS floor, unhealthy duration, restart cooldown, between-games recal |

Bridge-only knobs also live in `tools/autodarts-companion/config.example.yaml` (overwritten by the start script when you use board-station).

### TV on HDMI / second display

- **Same PC → TV:** set Windows to extend or duplicate to the HDMI display; open kiosk on that monitor (drag once, or set Windows “show on” before kiosk).
- **Second browser window:** `kiosk.open_tv: true` launches `--kiosk {no3.url}/tv`.
- If kiosk lands on the wrong screen: exit kiosk (`Alt+F4`), move a normal window to the TV, re-run with kiosk, or use Windows display settings to make the TV primary for that session.

### iPad

Open `{no3.url}/play` (bookmark it). Start any game mode on room **Board 1** (or whatever `room_id` is). Keep the play screen open so the match heartbeats to the TV.

## Corrections (Autodarts ↔ No3)

Misreads can be fixed in either place; No3 must end up with the right visit.

### From Autodarts Board Manager

Bridge watches `/api/state` throw lists:

| State change | Bridge action |
|--------------|---------------|
| New dart appended | `POST /api/camera/dart` (once — idempotent) |
| Prior throw changed / replaced / removed | `POST /api/camera/correct` with **full** current visit |
| Takeout / throws cleared | `POST /api/camera/end-turn` |

`/api/camera/correct` rebuilds the open visit via the game engine (`correctCurrentTurn`) so scores stay consistent (no double-scoring).

### From the iPad (preferred for players)

On `/play`:

1. **Tap the wrong dart** in the current visit
2. **Pick the right segment** (drag board or keys) — Autodarts mental model
3. Or use **Undo** / **Edit** / **End** in the header

Players should not need to walk to Board Manager for routine fixes.

## Camera health + auto-restart

Bridge evaluates Board Manager reachability and any FPS / camera fields exposed on `/api/state` (versions differ; missing FPS ≠ failure by itself).

When unhealthy longer than `health.unhealthy_seconds`:

1. Notify No3 → `POST /api/camera/health` → SSE `camera_health`
2. iPad / TV show **“Detection restarting…”** / **“Cameras unhealthy”**
3. Restart Board Manager process (`exe_path` + `process_names`) after cooldown
4. Wait for `/api/state` again and report recovery

Disable with `health.enabled: false` or `python -m companion bridge --no-health`.

### Between games (calibration / reset)

When the board is empty after takeout (safe window), bridge probes local HTTP reset/calibrate paths (`/api/reset`, `/api/calibrate`, …). **Not all Board Manager builds expose these.**

- If a probe succeeds → logged as `recal OK`
- If none accept → **manual fallback:** open Board Manager UI → Calibration / reset between games when cams drift

`health.between_games_recal: false` skips the probe.

## Related docs

- [`docs/CAMERA.md`](./CAMERA.md) — camera REST contract (`dart`, `correct`, `end-turn`, `health`, SSE)
- [`tools/autodarts-companion/README.md`](../tools/autodarts-companion/README.md) — bridge CLI, spy/probe/compare

## Quick checklist (John)

1. Cams + ring light on; Board Manager calibrated once  
2. Edit `tools/board-station/config.yaml` (`exe_path`, No3 URL, room)  
3. Double-click `start-board.bat`  
4. iPad → play URL → start match on that room  
5. TV shows `/tv`  
6. Throw; if misread → tap dart on iPad **or** correct in Board Manager (bridge syncs)  
7. If cams die → wait for toast + auto-restart; if still dead, relaunch Board Manager manually  
