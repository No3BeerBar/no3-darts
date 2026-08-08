# Autodarts companion / spy

Run **beside Autodarts** (not instead of it) to learn how their board scores darts and to compare against No3.

## What this is (and is not)

| This does | This does **not** |
|-----------|-------------------|
| Talk to Autodarts **Board Manager** on your LAN (`localhost:3180`) | Reverse-engineer proprietary binary CV code |
| Log full `/api/state` JSON (throws, segments, anything they publish) | Guarantee raw per-camera tip pixels (may not be exposed) |
| Plot scores on a standard board diagram | Steal Autodarts detection models |
| Diff Autodarts vs No3 when both see the same throw | Require internet (stays local) |

Autodarts detects from **pixel change** with **3 cams ~120°** on a ring light; publicly documented integrations only need the **local Board Manager API**. Community tools (ioBroker, Tools for Autodarts) poll that same API.

## Prerequisites

1. Autodarts Desktop / Board Manager running  
2. Open in a browser: `http://127.0.0.1:3180`  
3. Board started (status **Throw** / green)  
4. Python 3.11+ on the **same PC** (or any PC that can reach the Board Manager)

## Quick start (Windows mini PC)

```powershell
cd C:\No3Darts\no3-darts
git pull
cd tools\autodarts-companion

python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

copy config.example.yaml config.yaml
# edit host if Board Manager is not on this machine

python -m companion spy
```

Or: `scripts\run-spy.bat`

## Commands

### `spy` — watch Autodarts live
```powershell
python -m companion spy
python -m companion spy --host 127.0.0.1 --port 3180 --dump
```

- Polls `GET /api/state` every ~0.3s  
- Prints new darts (`T20`, `S5`, bull, miss…)  
- With `--dump`, appends every unique state to `logs/session-*.jsonl`  
- Probes extra paths (`/api/config`, `/api/host`, …) once at start  

### `probe` — discover API endpoints
```powershell
python -m companion probe
```

Hits common Board Manager paths and prints status + JSON shape. Use this first if `spy` fails.

### `compare` — Autodarts vs No3 side-by-side
```powershell
python -m companion compare --no3-url https://no3-darts-production.up.railway.app --room "Board 1"
```

Listens to Autodarts throws and, when No3 posts a dart near the same time, prints both scores.

### `viz` — live board diagram from Autodarts throws
```powershell
python -m companion viz
```

Draws an OpenCV board with Autodarts hits marked (needs a window).

### `bridge` — use Autodarts as the detector for No3
When DIY CV is not ready for the bar, Autodarts can own detection and
**mirror scores into No3** (iPad / TV still work):

```powershell
python -m companion bridge --no3-url https://no3-darts-production.up.railway.app --room "Board 1"
```

Or: `scripts\run-bridge.bat`

Start a No3 match on that room, leave Autodarts detecting, throw.

## What we hope to learn

From logged JSON (when present in your Board Manager version):

- Segment name / number / multiplier  
- Any **coords** (`x`, `y`, `r`, `angle`, camera ids)  
- Board **status** machine: Throw → Throw detected → Takeout → …  
- Camera config (resolution / fps)

If only segment scores appear (no coordinates), that still tells us **when** they lock a dart and how takeout works—still useful for aligning No3.

## Typical Autodarts geometry (public knowledge)

- 3 USB cams around the board (~120°)  
- Even **ring light** (critical)  
- Motion / pixel-diff → dart present  
- Multi-view fusion → score  
- Calibrate in Board Manager (magic wand / auto-cal)  

Their **internal** triangulation stays closed-source; this tool studies the **outputs** and timing so we can reshape No3 to match.

## Config

See `config.example.yaml`:

```yaml
autodarts:
  host: "127.0.0.1"
  port: 3180
  poll_ms: 300

no3:
  url: "https://no3-darts-production.up.railway.app"
  room_id: "Board 1"

logs_dir: "./logs"
```

## Privacy

Everything stays on your LAN. Do not commit API keys or `logs/*.jsonl` with personal data.
