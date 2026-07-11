# No3 Darts – DIY Detection System

**This is our own computer-vision stack.** It does **not** use Autodarts hardware or software.

It runs on a machine **next to the dartboard** (bar PC, Intel NUC, or Raspberry Pi 5), watches one or more cameras, maps dart tips to segments, and posts scores into the No3 web app:

```http
POST /api/camera/dart
```

```
┌─────────────┐   USB/RTSP    ┌──────────────────────┐   HTTP    ┌─────────────────┐
│ Cam 0/1/2   │ ───────────► │ no3_detect (Python)  │ ───────► │ No3 Darts web   │
│ around board│               │ OpenCV + geometry   │          │ /api/camera/*   │
└─────────────┘               └──────────────────────┘          │ tablet / TV UI  │
                                                                └─────────────────┘
```

---

## Hardware (recommended)

| Item | Notes |
|------|--------|
| **Cameras** | 1 works for v1; **2–3** better (≈120° apart, above/around the board) |
| **Type** | Fixed USB webcams (1080p ideal) or RTSP IP cams — **no auto-focus hunting** |
| **Mounts** | Rigid mounts; board + cameras must not move after calibration |
| **Lighting** | Even, bright, no flicker (avoid cheap PWM LEDs if possible) |
| **Computer** | x86 NUC/mini-PC preferred; Pi 5 OK for 1–2 cams |
| **Network** | Same LAN as tablet, or detector posts to Railway URL |

**Not required:** Autodarts cameras, Autodarts subscription, or their software.

---

## Software setup

### Windows mini-PCs (bar boards)

See **[WINDOWS.md](./WINDOWS.md)** for the full checklist, then:

```powershell
cd detection
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
.\scripts\setup-windows.ps1
# edit config.yaml → Railway URL + 3 cameras
python -m no3_detect list-cameras
python -m no3_detect calibrate --camera 0 --id cam0 --out .\calib\cam0.json
# … cam1, cam2 …
.\scripts\run-detector.bat
# optional: .\scripts\install-autostart.ps1
```

### Linux / macOS

```bash
cd detection
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp config.example.yaml config.yaml
# edit no3_api_url, room_id, camera sources
```

Start the No3 web app (another terminal):

```bash
cd ..
npm run dev
```

---

## Calibrate a camera

1. Mount the camera so the **entire board** is visible, as circular as possible.
2. Clear all darts from the board.
3. Run:

```bash
python -m no3_detect calibrate --camera 0 --id cam0 --out ./calib/cam0.json
```

| Key | Action |
|-----|--------|
| Mouse | Aim crosshair |
| `c` | Set **board center** (bull) |
| `r` | Set **outer double wire** radius (mouse on double ring) |
| `t` | Point at **center of the 20** segment → sets rotation |
| `s` | Save |
| `q` | Quit |

Repeat for `cam1`, `cam2` if you have more cameras. Paths go into `config.yaml`.

---

## Run live detection

```bash
# Empty the board, then:
python -m no3_detect run --config config.yaml
```

- Start a match in the browser (same `room_id` as config, default `Board 1`).
- Throw a dart; when motion settles, the tip is mapped and **POSTed** to the API.
- Preview windows show ROI + tip. Press **`b`** to reset background (empty board). **`q`** quits.
- `--dry-run` detects without posting.

---

## Test without cameras

Geometry unit check:

```bash
python -m no3_detect test-geometry
```

Fake darts into a running No3 app (start a match first):

```bash
python -m no3_detect simulate --url http://localhost:3000 --180
python -m no3_detect simulate --url http://localhost:3000 --count 9
```

---

## How detection works (v1)

1. **Background model** of the empty board (per camera).
2. **Motion** when a dart enters → wait for **settle** frames.
3. Foreground blob → **tip** = contour point nearest the bull (shaft points inward).
4. Tip pixel → **polar (r, θ)** via calibration → **segment** (S/D/T/bull/miss).
5. **Multi-cam fuse**: majority vote on `(kind, number)`.
6. **Debounce** + confidence gate → `POST /api/camera/dart`.
7. Web UI receives update via existing **SSE** (`useCameraSync`).

### Accuracy tips

- Calibrate carefully; re-calibrate if cameras move.
- Strong, even light; avoid shadows of the thrower on the board.
- 2–3 cameras dramatically cut single-view occlusion errors.
- After removing darts, press **`b`** or wait for idle background learning.
- Raise `motion_threshold` if lights flicker; lower if soft throws are missed.

---

## Config reference

See `config.example.yaml`:

- `no3_api_url` – `http://localhost:3000` or Railway URL  
- `camera_api_key` – must match server `CAMERA_API_KEY` if set  
- `room_id` – must match Admin → room name  
- `debounce_ms`, `min_confidence`, motion / blob thresholds  
- `cameras[]` – `source` (index or RTSP URL) + `calibration` path  

---

## Roadmap (our stack, not Autodarts)

| Phase | Goal |
|-------|------|
| **v1 (now)** | 1–3 cams, frame diff, polar segment map, API post |
| **v2** | Ellipse unwarp, multi-cam triangulation, better tip model |
| **v3** | Optional ML tip/refinement, auto-recalibrate, Pi image |
| **v4** | Per-board systemd service, bar multi-room dashboard |

---

## Layout

```
detection/
  config.example.yaml
  requirements.txt
  README.md
  no3_detect/
    board_geometry.py   # polar → S/D/T/bull
    calibration.py      # interactive calib
    motion_detector.py  # OpenCV frame-diff tip finder
    pipeline.py         # multi-cam + debounce + POST
    api_client.py       # No3 HTTP client
    simulate.py         # fake darts
    __main__.py         # CLI
  calib/                # your *.json (gitignored)
```

---

## Security

- Prefer detector on **LAN only**, tablet on LAN, optional tunnel to Railway.
- Set `CAMERA_API_KEY` on the web app and in `config.yaml` if the API is public.
