# TV display & attract mode

HDMI TV above the board opens **`/tv`** (board-station kiosk default).

## Modes

| State | What you see |
|-------|----------------|
| **Idle** (no active match for the room) | Attract loop — weekly + all-time leaderboards, available games, “start on iPad” CTA |
| **Live** | Match TV UI (scores + large leftover-column board + takeout banner) |

Switching is automatic:

1. Tablet heartbeats the match to `POST /api/matches` while playing.
2. TV polls `GET /api/matches/active?room=…` (~1.5s) and listens to SSE `/api/camera/stream`.
3. When a match appears → live scoring. After match end (win or End game) the last result holds ~30s, then attract. A new match skips the hold.

Room name comes from **Admin → room** (must match the iPad / board-station `room_id`, e.g. `Board 1`).

## Leaderboards (server)

`GET /api/leaderboard` returns weekly + all-time boards for **registered** players (Postgres).

### Query

| Param | Values | Default |
|-------|--------|---------|
| `weekMode` | `rolling7` \| `calendar` | `rolling7` |
| `mode` | `all` \| game mode id (`x01`, `baseball`, `forty_one`, …) | `all` |
| `minMatches` | number ≥ 1 | `1` |
| `limit` | 1–25 | `8` |

### Metrics

| id | Meaning | Which modes |
|----|---------|-------------|
| `avg` | Three-dart average | Modes with `leaderboard.average` (e.g. X01) |
| `wins` | Match wins | **Every** registered mode |
| `oneEighties` | 180s | Checkout-stat modes (X01) |
| `highestCheckout` | Highest checkout | Checkout-stat modes |
| `highScore` | Best **finishing** score | Modes with `leaderboard.highScore` (Baseball, **41**, Count-Up, Shanghai, …) |

Response includes:

- `modeCatalog` — each engine mode + which metrics it ranks (new modes are automatically wins-eligible when registered in the engine)
- `weekly` / `allTime` → `boards` (filtered by `mode=`) and `byMode` (per-mode sections for TV attract / Stats)

Finished matches store `matches.mode` + human `mode_label` (e.g. `forty_one` / `41`) and `match_players.final_score` for high-score boards.

**Guests vs PIN accounts:** anyone may play without an account. Guest-only matches are not persisted. Leaderboards and per-mode boards (41, Baseball, …) credit **registered players only**.

Weekly default = **rolling last 7 days** (`weekMode=calendar` for Mon–Sun). If `DATABASE_URL` is missing or Postgres is down, the API returns empty boards (`dbAvailable: false`) and attract still shows **games + CTA** without crashing.

Attract rotates overall X01-style boards **and** per-mode panels (e.g. **41 · HIGH SCORE**, **Baseball · WINS**) when data exists.

## Board station

`tools/board-station/config.example.yaml`:

```yaml
kiosk:
  open_tv: true
  tv_url: "{no3.url}/tv"
```

No separate `/tv/attract` URL is required — idle detection lives on `/tv`.

## Related

- [`docs/BOARD-STATION.md`](./BOARD-STATION.md) — mini-PC + iPad + TV wiring  
- [`docs/PLAYERS.md`](./PLAYERS.md) — PIN accounts + `finished_at` history  
