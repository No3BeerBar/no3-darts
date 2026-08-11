# Walk-up player accounts (name + PIN)

Bar tablets use **display name + 4-digit PIN** instead of email/password. Guests can still play with no account. **Bots** are ephemeral AI seats (no account, no PIN, no stats) — see [`PLAY.md`](./PLAY.md#bot-opponents). Registered stats live in **Postgres** so they follow the player across devices.

## How it works

1. **Create account** — player picks a display name (2–24 chars) and a 4-digit PIN on the tablet numpad.
2. **Sign in** — same name + PIN. Session is an **httpOnly cookie** (`no3_player_session`) that stays on that tablet until **Sign out** (~30 days), or until **2 minutes idle** on idle play / setup (not mid-match). See [`PLAY.md`](./PLAY.md).
3. **Saved players** — on a **cold** tablet, open the searchable directory (not a dump of 50+ names) → tap name → PIN. With no session, PIN **signs in** (sticky). While signed in, setup shows those trusted names for quick re-seat; unlocking another seat adds them to that quick list without stealing the cookie. Idle logout / Sign out clears everyone → cold path again. Guests stay one-tap (+ Guest). Bots are separate (+ difficulty chip) — not in the directory.
4. **Resume** — in-progress games persist on the tablet, but registered seats must still be verified. After **Sign out** (or a cleared session), Resume prompts for PIN again before scoring; guests-only / bot seats do not need PIN. See [`PLAY.md`](./PLAY.md).
5. **Match finish** — **guests and bots stay ephemeral**: no local history, no Postgres rows, no leaderboard credit for those seats. Only matches with at least one **registered** (name+PIN) player are saved (`localStorage` + `POST /api/matches/persist`). Server writes `match_players` / aggregates **only** for ids that exist in `players`.
6. **Lockout** — after 5 bad PINs, that account locks for 60 seconds.

PINs are stored as **bcrypt hashes** (`pin_hash`). APIs never return hashes.

## Schema (Postgres)

| Table | Purpose |
|-------|---------|
| `players` | id, name, name_normalized (unique, case-insensitive), pin_hash, lockout fields, aggregate stats |
| `matches` | finished match header with `finished_at` (weekly boards) |
| `match_players` | per-player row for **registered** players only (`player_id` set, `is_guest=false`). Guests are never inserted. |

Query personal history or future weekly tops via `match_players.player_id` + `matches.finished_at`.

## Env vars (required for accounts)

| Variable | On Railway service | Purpose |
|----------|--------------------|---------|
| **`DATABASE_URL`** | **no3-darts** (app) | Postgres connection string. Without it, auth APIs return 503 and guests/localStorage still work. |
| `SESSION_SECRET` | **no3-darts** (app) | HMAC secret for session cookies. Recommended in production. Falls back to `CAMERA_API_KEY` or `DATABASE_URL` if unset. |
| `STAFF_PIN` | optional | 4-digit PIN for staff Admin APIs (player PIN reset). Default `1234`. Keep matched with **Admin → Staff PIN** (local `/play` unlock). |
| `CAMERA_API_KEY` | optional | Unrelated to players; protects camera APIs. |

### `DATABASE_URL` checklist

The app reads **only** `process.env.DATABASE_URL` on the **no3-darts** web service (not on the Postgres plugin alone).

1. Railway project **no3-darts** must have a **Postgres** plugin/service.
2. On the **no3-darts** service → **Variables**, ensure:
   - Name: `DATABASE_URL`
   - Value: Railway variable reference to Postgres, e.g. `${{Postgres.DATABASE_URL}}`  
     (or the resolved `postgresql://…` URL)
3. Redeploy **no3-darts** after adding/changing it.
4. Confirm: `GET /api/health` → `{ "database": { "configured": true, "available": true } }`.

Admin → **Player accounts** also shows this status after deploy.

If Postgres exists but `DATABASE_URL` is missing on **no3-darts**, accounts will stay offline until that variable is linked.

## Railway: attach / verify Postgres

**If Postgres is not in the project yet:**

1. Open [Railway](https://railway.app) → project **no3-darts**.
2. **New** → **Database** → **PostgreSQL** (same project).
3. Select the **no3-darts** service → **Variables** → **Add variable** / **Add reference**:
   - Variable name: `DATABASE_URL`
   - Reference: `Postgres` → `DATABASE_URL` (Railway UI shows this as `${{Postgres.DATABASE_URL}}`)
4. Optional but recommended: add `SESSION_SECRET` = a long random string (e.g. `openssl rand -hex 32`).
5. **Redeploy** no3-darts.
6. Hit `GET /api/health` and confirm `database.available: true`.

**If Postgres is already added:** only step 3–6 matter — confirm `DATABASE_URL` is on the **no3-darts** service, not only on the Postgres service.

Schema tables are created automatically on first DB use (no separate migrate job).

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
| POST | `/api/admin/players/reset-pin` | Staff only: `{ playerId, newPin, staffPin }` → overwrites `pin_hash`, clears lockout. Requires correct `staffPin` (`STAFF_PIN` / default `1234`). Never returns hashes or plaintext PINs. |
| GET | `/api/leaderboard` | weekly + all-time boards (TV attract; registered only). Supports `mode=` game-mode filter + `byMode` / `highScore` — see [`TV.md`](./TV.md) |
| POST | `/api/matches/persist` | finished match → server history + aggregates (`mode`, `mode_label`, `final_score`) |

### Staff: reset a forgotten PIN

Bar staff use **Admin → Reset player PIN** (see [`PLAY.md`](./PLAY.md)). Flow: pick registered player → set/generate temporary PIN → confirm with staff PIN → tell the patron the new digits. Guests have no PIN.

## Local dev with Postgres

```bash
# example — copy .env.example → .env.local
DATABASE_URL=postgres://user:pass@localhost:5432/no3_darts
SESSION_SECRET=dev-secret
npm run dev
```

Or leave `DATABASE_URL` unset and use guests only.
