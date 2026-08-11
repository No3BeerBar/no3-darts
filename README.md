# No3 Darts

Self-hosted automatic darts scoring for **No. 3 Craft Beer Bar**.

**Detection:** Autodarts Board Manager on the board PC.  
**Games / UI:** No3 (X01, Cricket, Killer, … on tablet + TV).  
A local bridge polls Autodarts and POSTs throws into No3.

![Stack](https://img.shields.io/badge/Next.js-15-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![Railway](https://img.shields.io/badge/Deploy-Railway-purple)

---

## Features (Phase 1)

### Game modes
| Mode | Notes |
|------|--------|
| **X01** | 301 / 501 / 701 / 901 · double-in / double-out |
| **Cricket** | Standard & cut-throat |
| **Shanghai** | Rounds 1–20 · Shanghai = instant win |
| **Baseball** | 9 innings · only current inning number scores · S/D/T = N×1/2/3 · highest total wins |
| **Count-Up** | Highest score after N turns |
| **Around the Clock** | 1→20 (+ optional bull) |
| **Bermuda** | Classic island target sequence |
| **Random Checkout** | Practice random finishes |
| **Killer** | Pub classic – arm on your double, last life wins |

Adding a mode: implement a handler in `src/engine/modes/`, register it in `src/engine/engine.ts`.

### Scoring UI
- Dark, high-contrast, bar/TV-ready layout
- **`/play` patron mode** by default (scores, thrower, board, tap-to-correct); staff Unlock/Edit/Undo behind PIN — see [`docs/PLAY.md`](./docs/PLAY.md)
- Quick keys / number pad available when staff unlock
- Live board highlight of last dart
- Checkout suggestions (X01 / practice)
- Callout toasts (180, bust, game shot…)
- Visit history uses **mode points** (Baseball visit Σ ≠ raw dart.value)

### Players & stats
- Guests (no account) + **walk-up accounts** (display name + 4-digit PIN)
- Personal stats in **Postgres** when `DATABASE_URL` is set (shared across tablets)
- Averages, 180s, checkouts, highest out
- Local leaderboard (+ **server** weekly / all-time boards for registered players)
- Match history with **JSON / CSV** export
- **TV attract mode** on `/tv` when the board is idle (leaderboards + games carousel)

Details: [`docs/PLAYERS.md`](./docs/PLAYERS.md) · [`docs/TV.md`](./docs/TV.md).

### Ops
- PWA installable on tablets
- Dockerfile + `railway.toml` for Railway
- REST API for camera / Autodarts bridge
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

## Recommended detection: Autodarts → No3 bridge

Autodarts owns cameras / throw detection. No3 owns match setup and game modes so the bar can run X01, Cricket, Killer, etc. without playing inside Autodarts.

```
[Autodarts cams] → Board Manager :3180 → companion bridge → No3 /api/camera/dart
```

### Bar mini-PC one-liner

On the board PC (Windows), with Autodarts Board Manager running:

```powershell
cd C:\No3Darts\no3-darts\tools\autodarts-companion
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy config.example.yaml config.yaml
# edit no3.url + room_id (+ camera_api_key if set on Railway)
python -m companion bridge
```

Or: `tools\autodarts-companion\scripts\run-bridge.bat`

Then start any No3 match on that room and throw. Details: [`tools/autodarts-companion/README.md`](./tools/autodarts-companion/README.md) · API: [`docs/CAMERA.md`](./docs/CAMERA.md).

> Experimental DIY OpenCV under [`detection/`](./detection/README.md) is **not** the recommended bar path.

---

## Deploy to Railway (GitHub)

1. Push this repo to GitHub.
2. In [Railway](https://railway.app) → **New Project** → **Deploy from GitHub**.
3. Railway will use the **Dockerfile** (`railway.toml`).
4. Optional variables (see `.env.example`):

| Variable | Purpose |
|----------|---------|
| `CAMERA_API_KEY` | Protect `/api/camera/*` and match APIs |
| **`DATABASE_URL`** | **Required for player accounts.** Postgres URL on the **no3-darts** service (e.g. `${{Postgres.DATABASE_URL}}`). Shared PIN accounts + personal stats. |
| `SESSION_SECRET` | HMAC secret for player session cookies (recommended; `openssl rand -hex 32`) |
| `PORT` | Set automatically by Railway |

**Railway Postgres:** In project **no3-darts**, add a Postgres plugin if missing, then set **`DATABASE_URL`** on the **no3-darts** web service (variable reference to Postgres). Redeploy and check `GET /api/health` → `database.available: true`. Full steps: [`docs/PLAYERS.md`](./docs/PLAYERS.md). Without `DATABASE_URL`, guests and local scoring still work.

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
      camera/       # dart webhook + end-turn + SSE stream
      matches/      # REST match control
tools/
  autodarts-companion/   # Autodarts → No3 bridge (recommended)
detection/               # Experimental DIY OpenCV (not recommended for bar)
```

**Client** holds the live match in `localStorage` (and Zustand).  
On each change it **syncs** state to the server in-memory registry so the bridge can post darts.

```
[Tablet UI] --localStorage--> [Zustand]
     |                            |
     +---- POST /api/matches -----+
                                  |
[Autodarts bridge] --POST /api/camera/dart--> [Server engine] --> SSE subscribers
```

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
| `npm test` | Unit tests (PIN hash, name rules, leaderboard helpers) |
| `npm run db:push` | Optional Drizzle schema push (auto-migrate also runs at runtime) |

---

## Roadmap ideas

- [ ] Wire sound / TTS callouts (toggles already in Admin)
- [ ] Heatmaps from `angle` / `radius` on darts
- [ ] Multi-room dashboard
- [x] Postgres persistence via `DATABASE_URL` (player accounts + match history)
- [x] Weekly / TV idle leaderboard UI (attract mode on `/tv`)
- [ ] Harden Autodarts bridge autostart on the bar mini-PC

---

## License

Private / use freely for No. 3 Craft Beer Bar operations.
