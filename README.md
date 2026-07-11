# No3 Darts

Self-hosted automatic darts scoring for **No. 3 Craft Beer Bar**, inspired by autodarts.io.

Modern Next.js app with a modular game engine, TV/tablet-friendly scoring UI, local multiplayer, stats, and a **DIY camera detection stack** (Python + OpenCV — **not Autodarts**).

![Stack](https://img.shields.io/badge/Next.js-15-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![Railway](https://img.shields.io/badge/Deploy-Railway-purple)

---

## Features (Phase 1)

### Game modes
| Mode | Notes |
|------|--------|
| **X01** | 301 / 501 / 701 / 901 · double-in / double-out |
| **Cricket** | Standard & cut-throat |
| **Shanghai** | Rounds 1–20 · Shanghai = instant win |
| **Count-Up** | Highest score after N turns |
| **Around the Clock** | 1→20 (+ optional bull) |
| **Bermuda** | Classic island target sequence |
| **Random Checkout** | Practice random finishes |
| **Killer** | Pub classic – arm on your double, last life wins |

Adding a mode: implement a handler in `src/engine/modes/`, register it in `src/engine/engine.ts`.

### Scoring UI
- Dark, high-contrast, bar/TV-ready layout
- Quick keys (S/D/T 1–20, 25, Bull, Miss), number pad, clickable dartboard
- Undo · end turn · pause/resume
- Live board highlight of last dart
- Checkout suggestions (X01 / practice)
- Callout toasts (180, bust, game shot…)

### Players & stats
- Guests + saved profiles
- Averages, 180s, checkouts, highest out
- Local leaderboard
- Match history with **JSON / CSV** export

### Ops
- PWA installable on tablets
- Dockerfile + `railway.toml` for Railway
- REST API for camera software
- Optional `CAMERA_API_KEY`

---

## Quick start (local)

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm run build && npm start   # production
```

---

## Windows mini-PC (cameras) — one-liner

On the board PC, PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
irm https://raw.githubusercontent.com/No3BeerBar/no3-darts/main/detection/scripts/install-from-github.ps1 | iex
```

Details: [`detection/INSTALL-MINIPC.md`](./detection/INSTALL-MINIPC.md) · [`detection/WINDOWS.md`](./detection/WINDOWS.md)

---

## Deploy to Railway (GitHub)

1. Push this repo to GitHub.
2. In [Railway](https://railway.app) → **New Project** → **Deploy from GitHub**.
3. Railway will use the **Dockerfile** (`railway.toml`).
4. Optional variables (see `.env.example`):

| Variable | Purpose |
|----------|---------|
| `CAMERA_API_KEY` | Protect `/api/camera/*` and match APIs |
| `DATABASE_URL` | Reserved for future Postgres persistence |
| `PORT` | Set automatically by Railway |

5. Health check: `GET /api/health`

Nixpacks also works (no Docker): remove/adjust `railway.toml` and let Railway detect Next.js. Prefer Docker for reproducible builds with `output: "standalone"`.

---

## Architecture

```
src/
  engine/           # Pure TS game engine (no React)
    modes/          # X01, Cricket, Shanghai, …
    checkout.ts     # Checkout suggestions
    engine.ts       # createGame, applyDart, undo, …
  store/            # Zustand client state
  lib/              # localStorage, server match registry, export
  components/       # Scoring UI, board, setup
  app/
    play/           # Full-screen scorer
    api/
      camera/       # dart webhook + SSE stream
      matches/      # REST match control
```

**Client** holds the live match in `localStorage` (and Zustand).  
On each change it **syncs** state to the server in-memory registry so camera software can post darts.

```
[Tablet UI] --localStorage--> [Zustand]
     |                            |
     +---- POST /api/matches -----+
                                  |
[Camera / CV] --POST /api/camera/dart--> [Server engine] --> SSE subscribers
```

---

## DIY camera detection (not Autodarts)

We build our **own** detector under [`detection/`](./detection/README.md):

1. Cameras around the board (1–3 USB/RTSP)
2. Python OpenCV process on a bar PC / Pi
3. Posts hits to `POST /api/camera/dart`
4. Play UI merges them via SSE

```bash
cd detection
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m no3_detect test-geometry
python -m no3_detect calibrate --camera 0 --id cam0 --out ./calib/cam0.json
# edit config.yaml, then:
python -m no3_detect run --config config.yaml
```

API payload and auth: [`docs/CAMERA.md`](./docs/CAMERA.md).

> Server match state is **in-memory** (per instance). Fine for a single Railway service. For multi-instance scale-out, swap `src/lib/server-game-store.ts` for Redis.

---

## PWA (tablet kiosk)

1. Open the site in Chrome/Safari on the tablet.
2. **Add to Home Screen** / Install app.
3. Use full-screen scoring at `/play`.
4. Admin → enable **Kiosk / TV mode** flag for denser chrome (optional).

Icons live in `public/icons/`. Manifest: `public/manifest.webmanifest`.

---

## Branding

Default branding is **No. 3 Craft Beer Bar** (amber accent on near-black).  
Change bar name, room name, and toggles under **Admin**.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm run lint` | ESLint |

---

## Roadmap ideas

- [ ] Wire sound / TTS callouts (toggles already in Admin)
- [ ] Heatmaps from `angle` / `radius` on darts
- [ ] Multi-room dashboard
- [ ] Postgres persistence via `DATABASE_URL`
- [ ] Detection v2: ellipse unwarp, multi-cam triangulation, ML tip refine
- [ ] systemd / Docker image for bar mini-PC detector

---

## License

Private / use freely for No. 3 Craft Beer Bar operations.
