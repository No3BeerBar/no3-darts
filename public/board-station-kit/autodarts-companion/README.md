# Autodarts -> No3 companion

**Recommended bar path:** Autodarts Board Manager **detects** throws; No3 runs **game modes and scoring UI** (X01, Cricket, Killer, ...). A small local bridge on the board PC polls Autodarts and POSTs darts into No3.

```
[Autodarts cams] -> Board Manager :3180 -> companion bridge -> POST /api/camera/dart|correct|end-turn|health -> No3 (tablet / TV)
```

**Bar one-script start** (Board Manager + bridge + TV kiosk URL): [`tools/board-station/`](../board-station/) - see [`docs/BOARD-STATION.md`](../../docs/BOARD-STATION.md).

Game setup, players, legs, and modes stay in No3. Autodarts is detector-only (no need to play the match inside Autodarts).

## What this is (and is not)

| This does | This does **not** |
|-----------|-------------------|
| Talk to Autodarts **Board Manager** on your LAN (`localhost:3180`) | Reverse-engineer proprietary binary CV code |
| Poll `GET /api/state` and mirror throws into No3 | Require playing the game inside Autodarts |
| Map segments (`T20`, `S5`, bull, miss...) -> No3 `{kind,number}` | Guarantee raw per-camera tip pixels |
| Call No3 `end-turn` on Autodarts takeout | Steal Autodarts detection models |
| Sync mid-visit **corrections** via `/api/camera/correct` | Ignore Autodarts throw edits |
| Watch FPS/cam health, restart Board Manager, toast No3 | Reverse-engineer Autodarts CV |
| Spy / compare / viz helpers for debugging | Need internet (stays local except No3 POST) |

Community tools (ioBroker, Tools for Autodarts) use the same local Board Manager HTTP API.

## Prerequisites

1. Autodarts Desktop / Board Manager running on the board PC  
2. Open in a browser: `http://127.0.0.1:3180`  
3. Board started (status **Throw** / green)  
4. Python 3.11+ on that PC  
5. A No3 match open on the **same room** (any game mode)

## Bar mini-PC one-liner (bridge)

```powershell
cd C:\No3Darts\no3-darts\tools\autodarts-companion
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy config.example.yaml config.yaml
# edit config.yaml -> no3.url, room_id, camera_api_key
python -m companion bridge
```

Or double-click / run: `scripts\run-bridge.bat`

Dry-run (no No3 POSTs):

```powershell
python -m companion bridge --dry-run
scripts\run-bridge.bat --dry-run
```

Full CLI:

```powershell
python -m companion bridge --help
python -m companion bridge `
  --host 127.0.0.1 --port 3180 --poll-ms 300 `
  --no3-url https://no3-darts-production.up.railway.app `
  --room "Board 1" `
  --api-key "%CAMERA_API_KEY%"
```

Env vars also work: `NO3_URL`, `CAMERA_API_KEY`.

### Match flow

1. On the tablet: start any No3 game (X01 / Cricket / Killer / ...) on room **Board 1**.  
2. On the board PC: Autodarts Board Manager **Start** (detecting).  
3. Run `bridge` - each new Autodarts dart is POSTed to No3.  
4. When Autodarts signals **Takeout** with a full 3-dart visit (or confirms an early pull via sustained empty polls), bridge calls `POST /api/camera/end-turn`. Takeout while only 1-2 throws are visible **defers** end-turn; a one-poll Takeout-finished flicker must not seat-jump dart 3. While mirroring a visit the bridge **locks the No3 seat** (`expectedPlayerIndex`). After a full 3-dart visit No3 usually auto-ends already; the extra end-turn is harmless.
5. If a throw is **corrected** in Board Manager (changed/removed), bridge calls `POST /api/camera/correct` with the full visit - no double-scoring.
6. Players can also fix on the iPad: tap the dart -> pick the right segment.
7. Health: FPS / disconnect -> notify No3 + restart Board Manager (needs `exe_path` in config).

## Commands

### `bridge` - Autodarts detects -> No3 scores (recommended)

```powershell
python -m companion bridge
python -m companion bridge --dry-run
python -m companion bridge --no-end-turn
python -m companion bridge --no-health
```

### `spy` - watch Autodarts live

```powershell
python -m companion spy
python -m companion spy --host 127.0.0.1 --port 3180 --dump
```

- Polls `GET /api/state` every ~0.3s  
- Prints new darts (`T20`, `S5`, bull, miss...)  
- With `--dump`, appends every unique state to `logs/session-*.jsonl`  

### `probe` - discover API endpoints

```powershell
python -m companion probe
```

### `compare` - Autodarts vs No3 side-by-side

```powershell
python -m companion compare --no3-url https://... --room "Board 1"
```

### `viz` - live board diagram from Autodarts throws

```powershell
python -m companion viz
```

## Segment mapping -> No3

| Autodarts | No3 `kind` | `number` |
|-----------|------------|----------|
| S1-S20 / singles `1`-`20` | `single` | 1-20 |
| D1-D20 | `double` | 1-20 |
| T1-T20 | `triple` | 1-20 |
| `25` / outer bull | `outer_bull` | 25 |
| Bull / D25 / 50 | `bull` | 50 |
| Miss / `0` / M... | `miss` | 0 |

Parsing prefers `segment.number` + `segment.multiplier` (stable across Board Manager versions) and falls back to `segment.name`.

## Takeout / end-turn

Autodarts `/api/state` fields (Board Manager docs): **status** Board State (`Throw`, `Throw detected`, `Takeout`, `Takeout started`, `Takeout finished`) and **event** Detection State (`Wait`, `Stable`, `Empty`, `Dart`, `Hand`, `Partial Takeout`, `Takeout`). Active remove-darts = Takeout / Takeout started / Hand / Partial Takeout. **Takeout finished** means complete - it must not leave Pull-darts stuck.

On takeout (or when the `throws` list clears), the bridge calls:

```http
POST /api/camera/end-turn
{ "roomId": "Board 1" }
```

Poll order: mirror AD throw appends/replaces onto the **current** No3 seat first, then end-turn on Takeout. A 3-dart visit that becomes Takeout in the same poll still scores all 3 on one seat. Incomplete visits need sustained empty polls before early-pull end-turn (not a single Takeout-finished clear). The bridge locks `currentPlayerIndex` for the open visit and sends `expectedPlayerIndex` (server requires it while a visit is open; 409 on mismatch). After turn end the server **holds next-seat scoring** until takeout clear / Ready. If AD re-shows a closed visit after unlock, that continuation is refused. After the visit closes, further dart/correct posts freeze until the board is empty and AD leaves *active* takeout. The bridge reports `takeout: true` on `/api/camera/health` so `/play` can show **Pull darts - takeout**. Patron **Ready** hits `/api/camera/takeout-ready` (clears banner + handshake); the bridge may probe Board Manager `/api/reset` and unlocks when throws are empty. Mid-match between-games recal stays gated.

Disable end-turn with `--no-end-turn` if you only want dart posts.

## Corrections

Append-only polls still use `/api/camera/dart`. When the throw list **diverges** (e.g. T20->T19) or **shrinks** mid-visit, the bridge posts:

```http
POST /api/camera/correct
{ "roomId": "Board 1", "darts": [ /* full current visit */ ] }
```

See [`docs/CAMERA.md`](../../docs/CAMERA.md) and [`docs/BOARD-STATION.md`](../../docs/BOARD-STATION.md).

## Health / restart

With `health.enabled: true` (default), the bridge posts `/api/camera/health` and may restart Board Manager when offline or FPS stays below `fps_min`. Set `autodarts.exe_path` (or `health.exe_path`) so restart can relaunch the app.

Between games, the bridge probes local reset/calibrate HTTP paths only when the board is empty **and** No3 has no playing/paused match on the room (real game boundary - not every visit takeout). If none exist, calibrate manually in Board Manager.

## Config

See `config.example.yaml` (board-station overwrites this when you use `start-board.bat`):

```yaml
autodarts:
  host: "127.0.0.1"
  port: 3180
  poll_ms: 300
  exe_path: ""   # editable path for auto-restart

no3:
  url: "https://no3-darts-production.up.railway.app"
  room_id: "Board 1"
  camera_api_key: ""

health:
  enabled: true
  fps_min: 5.0
  unhealthy_seconds: 15.0
  between_games_recal: true

logs_dir: "./logs"
```

## Tests

Dev-only (not installed on the bar mini-PC):

```powershell
pip install -r requirements-dev.txt
python -m pytest -q
```

## Typical Autodarts geometry (public knowledge)

- 3 USB cams around the board (~120 deg)  
- Even **ring light** (critical)  
- Calibrate in Board Manager  

We only use the **local HTTP API** outputs - not Autodarts CV internals.

## Privacy

Everything stays on your LAN except POSTs to your No3 URL. Do not commit API keys or `logs/*.jsonl` with personal data.
