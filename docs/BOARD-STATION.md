# Board station (mini-PC + iPad + TV)

Bar ops guide for **No. 3 Craft Beer Bar**: Autodarts detects throws; No3 scores and shows the match.

**Mini-PC bootstrap:** download [`Board1-Setup.bat`](https://no3-darts-production.up.railway.app/Board1-Setup.bat) → double-click. **Single file** — Edge only needs the `.bat` (setup PowerShell is embedded; no separate `.ps1` fetch). It pulls the kit zip, writes Board 1 `config.yaml`, finds Autodarts if possible, and runs `start-board.bat`. Kit zip: [`/board-station-board1.zip`](https://no3-darts-production.up.railway.app/board-station-board1.zip).

> DIY OpenCV under `detection/` is experimental — **not** the bar path. Prefer Autodarts Board Manager + companion bridge.

## Wiring

| Piece | Role |
|-------|------|
| **Windows mini-PC** | Autodarts Board Manager, companion bridge, optional TV browser kiosk |
| **3× USB cams + ring light** | Autodarts hardware (calibrate in Board Manager) |
| **iPad** | Player interaction — No3 `/play` (setup, undo, fix dart, end turn) |
| **TV (HDMI)** | Match view — No3 `/tv` (attract when idle; live scores when a match is on). Same mini-PC HDMI out **or** second display. |

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

1. Loads `config.yaml` via companion PyYAML (`load-config.py`) — editable, not hardcoded paths
2. Starts / waits for Autodarts Board Manager (`exe_path` + `/api/state` ready check)
3. Writes companion `config.yaml` and launches `python -m companion bridge` (new window)
4. Optionally opens Edge/Chrome **kiosk** to the TV match URL on the mini-PC HDMI/TV
5. Prints the **iPad play URL** (and ASCII QR when possible) — iPad is a separate device; URL only

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
- **Idle / attract:** with no active match for `room_id`, `/tv` rotates weekly + all-time leaderboards, available games, and a start-on-iPad CTA. Starting a match on the iPad flips to live scoring; saving/discarding returns to attract. Details: [`docs/TV.md`](./TV.md).
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

Bridge probes local HTTP reset/calibrate paths (`/api/reset`, `/api/calibrate`, …) only when **both** are true:

1. Autodarts board is empty at a takeout / throw boundary  
2. No3 reports **no live playing/paused match** on that room (`GET /api/matches/active`) — i.e. between games or at `leg_won` / `match_won`

Ordinary visit takeout while a match is `playing` does **not** run recal (avoids mid-game “Board reset between games” and sticky hits).

- If a probe succeeds → logged as `recal OK` + green toast on `/play`  
- If none accept → **manual fallback:** open Board Manager UI → Calibration / reset between games when cams drift  

`health.between_games_recal: false` skips the probe.

### Takeout / remove-darts

Autodarts Board Manager `/api/state` (official Board / Detection states):

| Field | Role | Remove-darts values |
|-------|------|---------------------|
| `status` | Board State | `Takeout`, `Takeout started` (active); `Takeout finished` = complete |
| `event` | Detection State | `Hand`, `Partial Takeout`, `Takeout` (active); `Empty` when clear |
| `throws` / `numThrows` | Counted darts | Often still present during active Takeout |

Active remove-darts **pauses** camera scoring. `Takeout finished` means takeout completed — it must **not** leave Pull-darts stuck.

Each poll **syncs AD throw growth onto the current No3 seat first**, then handles takeout/end-turn. That way a 3-dart visit that flips to Takeout in the same poll still maps all 3 darts to one seat (never dart 3 on the next player).

**Takeout with fewer than 3 throws defers end-turn** until dart 3 is mirrored or the board stays empty for several polls after takeout (confirmed early pull). A one-poll `Takeout finished` / clear flicker after dart 2 must not advance the seat.

**Visit seat lock:** while mirroring an open AD visit, the bridge locks No3 `currentPlayerIndex` and sends `expectedPlayerIndex` on `dart` / `correct` / `end-turn`. The server **requires** that field while a visit is open and **409**s mismatches. After the visit closes, the server **holds next-seat scoring** until takeout is cleared (health `takeout_cleared`) or patron **Ready**. Late AD throws after a premature close cannot start the next seat’s visit. If AD re-shows a closed visit after unlock (late dart 3), the bridge also refuses that continuation.

`/play` shows **Pull darts — takeout** with **Ready** (acks via `POST /api/camera/takeout-ready`). Ready clears the stuck banner + handshake (bridge + UI agree) and may probe Board Manager `/api/reset`. Mid-match **between-games recal** stays gated on No3 match boundary.

### Redeploy on the mini-PC (required after bridge fixes)

Old companion bridge processes keep the previous takeout / seat-lock bugs. After pulling a new kit:

1. Close any open **companion bridge** console windows (or let `start-board.bat` kill them).
2. Double-click **`start-board.bat`** again (it stops old `python -m companion bridge` PIDs, then starts a fresh bridge).
3. Confirm the new bridge window shows the Autodarts → No3 banner and is polling `/api/state`.

## Related docs

- [`docs/CAMERA.md`](./CAMERA.md) — camera REST contract (`dart`, `correct`, `end-turn`, `health`, SSE)
- [`tools/autodarts-companion/README.md`](../tools/autodarts-companion/README.md) — bridge CLI, spy/probe/compare

## Quick checklist (John)

1. Cams + ring light on; Board Manager calibrated once  
2. Edit `tools/board-station/config.yaml` (`exe_path`, No3 URL, room)  
3. **Kill any old bridge window**, then double-click `start-board.bat` (redeploy = new kit zip + restart)  
4. iPad → play URL → start match on that room  
5. TV shows `/tv` (attract until a match starts)  
6. Throw; if misread → tap dart on iPad **or** correct in Board Manager (bridge syncs)  
7. After a visit: Pull darts; if banner stuck → tap **Ready** on `/play`  
8. End match on iPad → TV returns to attract  
9. If cams die → wait for toast + auto-restart; if still dead, relaunch Board Manager manually  
