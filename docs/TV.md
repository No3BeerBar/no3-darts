# TV display & attract mode

HDMI TV above the board opens **`/tv`** (board-station kiosk default).

## Modes

| State | What you see |
|-------|----------------|
| **Idle** (no active match for the room) | Attract loop — weekly + all-time leaderboards, available games, “start on iPad” CTA |
| **Live** | Existing match TV UI (scores + board + callouts) |

Switching is automatic:

1. Tablet heartbeats the match to `POST /api/matches` while playing.
2. TV polls `GET /api/matches/active?room=…` (~1.5s) and listens to SSE `/api/camera/stream`.
3. When a match appears → live scoring. When it is cleared / times out after finish → attract.

Room name comes from **Admin → room** (must match the iPad / board-station `room_id`, e.g. `Board 1`).

## Leaderboards (server)

`GET /api/leaderboard` returns weekly + all-time boards for **registered** players (Postgres):

- Three-dart average  
- Match wins  
- 180s  
- Highest checkout  

Weekly default = **rolling last 7 days** (`weekMode=calendar` for Mon–Sun). Guests are excluded. If `DATABASE_URL` is missing or Postgres is down, the API returns empty boards (`dbAvailable: false`) and attract still shows **games + CTA** without crashing.

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
