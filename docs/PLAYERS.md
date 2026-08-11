# Walk-up player accounts (name + PIN)

Bar tablets use **display name + 4-digit PIN** instead of email/password. Guests can still play with no account. Registered stats live in **Postgres** so they follow the player across devices.

## How it works

1. **Create account** — player picks a display name (2–24 chars) and a 4-digit PIN on the tablet numpad.
2. **Sign in** — same name + PIN. Session is an **httpOnly cookie** (`no3_player_session`) that stays on that tablet until **Sign out** (~30 days).
3. **Picker** — registered names appear on setup. Tapping someone else prompts for their PIN (does not steal the tablet session). Guests stay one-tap.
4. **Match finish** — client still saves to `localStorage`, and also `POST /api/matches/persist`. Server updates aggregates only for **registered** player ids; guests stay ephemeral.
5. **Lockout** — after 5 bad PINs, that account locks for 60 seconds.

PINs are stored as **bcrypt hashes** (`pin_hash`). APIs never return hashes.

## Schema (Postgres)

| Table | Purpose |
|-------|---------|
| `players` | id, name, name_normalized (unique, case-insensitive), pin_hash, lockout fields, aggregate stats |
| `matches` | finished match header with `finished_at` (weekly boards) |
| `match_players` | per-player row linked to `player_id` (null for guests) |

Query personal history or future weekly tops via `match_players.player_id` + `matches.finished_at`.

## Env vars

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | for accounts | Postgres connection string |
| `SESSION_SECRET` | recommended | HMAC secret for session cookies. Falls back to `CAMERA_API_KEY` or `DATABASE_URL` if unset |

Without `DATABASE_URL`, the app **does not crash**: auth APIs return 503, guests + localStorage keep working.

## Railway: attach Postgres (John)

1. Open the **no3-darts** service in [Railway](https://railway.app).
2. **New** → **Database** → **PostgreSQL** (same project).
3. Open the Postgres service → **Variables** → copy `DATABASE_URL`.
4. On the **no3-darts** service → **Variables** → **Add variable** → reference the Postgres `DATABASE_URL` (Railway variable reference), or paste it.
5. Optional: set `SESSION_SECRET` to a long random string.
6. Redeploy. Check `GET /api/health` → `database.available: true`.

Schema is created automatically on first DB use (no separate migrate job).

## API

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/auth/register` | `{ name, pin }` → sets session cookie |
| POST | `/api/auth/login` | `{ name, pin }` → sets session cookie |
| POST | `/api/auth/verify` | `{ name, pin }` → no session change |
| POST | `/api/auth/logout` | clears cookie |
| GET | `/api/auth/me` | current session player |
| GET | `/api/players` | public names + stats (no hashes) |
| GET | `/api/players/:id/stats` | aggregates + recent history |
| POST | `/api/matches/persist` | finished match → server history + aggregates |

## Local dev with Postgres

```bash
# example
export DATABASE_URL=postgres://user:pass@localhost:5432/no3_darts
export SESSION_SECRET=dev-secret
npm run dev
```

Or leave `DATABASE_URL` unset and use guests only.
