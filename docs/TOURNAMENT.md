# Tournament mode (v1)

Single-elimination brackets for **No. 3 Craft Beer Bar**, with **flexible match setup** and **3 cooperating lanes** (`Board 1`, `Board 2`, `Board 3`). Shared state lives in **Postgres** so every tablet/TV sees the same bracket.

## Staff-only setup

**Creating tournaments, editing drafts, starting the bracket, and assigning matches to Board 1/2/3 is staff/admin only.**

- Entry point: **Admin → Open tournament setup** (`/tournament`), not the patron Play kiosk nav.
- Unlock with the same **Staff PIN** used for `/play` admin tools (**Admin → Staff PIN**, default `1234`). Keep it matched with Railway **`STAFF_PIN`**.
- Mutating APIs (`POST/PATCH` create/update/start/assign) require `staffPin` (body or `X-Staff-Pin` header) verified server-side via `verifyStaffPin`.
- Guests may **play** in a tournament; they must not run the night (no setup without staff PIN).

**Start tournament match is staff-gated on patron Play.** Cold `/play` and `/` do **not** show the **Tournament match ready** card. Staff unlock on that tablet (long-press logo + PIN, Admin link, or `?admin=1`) reveals the lane card so a lane station can start the assigned match. Scoring an already-started tournament match stays on normal `/play` (no extra unlock).

## Bar flow (ops)

1. **Staff tablet** → **Admin** → **Open tournament setup** (staff PIN unlock).
2. **Create draft** → name the event.
3. **Setup**
   - Add **guests** (event-only names) and/or **PIN players**.
   - Guests play the event only; they do **not** get persistent history/leaderboards outside the tournament (John rule). Event bracket standings are fine.
   - Choose **first-to-N legs** (best-of = 2N−1).
   - Choose **game policy**:
     - **fixed** — same mode every leg (e.g. 501).
     - **choose_each_leg** — staff/players pick from allowed modes at the start of each leg.
     - **preset_sequence** — list modes per leg index (leg 1, leg 2, …).
4. **Start tournament** — builds a power-of-2 bracket with **byes** as needed.
5. **Assign matches** on the bracket view to **Board 1 / 2 / 3** (one active assignment per lane).
6. **Lane tablets** — set room name in Admin (or open `/?room=Board%201` / `/play?room=Board%201`). **Staff-unlock** that tablet, then idle **Play** shows **Tournament match ready** → start → score as usual → match win auto-saves and advances the bracket. Unlocked lane stations only — not the public cold kiosk.
7. Lane frees; winner moves on; other boards poll for updates (~5s).

Casual non-tournament play is unchanged: start a normal match from Play without touching tournaments.

## Lanes

| Lane     | Typical use                          |
|----------|--------------------------------------|
| Board 1  | Default room name / Autodarts bridge |
| Board 2  | Second station                       |
| Board 3  | Third station                        |

APIs:

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/tournaments` | public | List |
| POST | `/api/tournaments` | **staff PIN** | Create draft |
| GET | `/api/tournaments/:id` | public | Get bracket |
| PATCH | `/api/tournaments/:id` | **staff PIN** | Update draft |
| POST | `/api/tournaments/:id/start` | **staff PIN** | Build bracket → active |
| POST | `/api/tournaments/:id/matches/:matchId/assign` | **staff PIN** | `{ lane }` or free |
| POST | `/api/tournaments/:id/matches/:matchId/start` | public (lane play) | Link live `GameState` id |
| POST | `/api/tournaments/:id/matches/:matchId/complete` | public (lane play) | Winner → advance |
| GET | `/api/tournaments/lanes` | public | Overview of 3 boards |
| GET | `/api/tournaments/lanes/:room` | public | Pull assigned match for a lane |

## Postgres

Tables (runtime-migrated like players/matches):

- `tournaments` — name, status (`draft` \| `active` \| `completed`), `format_json`
- `tournament_players` — display name, guest flag, optional `registered_player_id`
- `tournament_matches` — bracket slots, status, lane, `live_game_id`, next-match pointers

If `DATABASE_URL` is missing or Postgres is down, tournament APIs degrade (`dbAvailable: false` / 503). Casual scoring still works.

## Autodarts

Still **per-lane** as today: each board PC bridges into its own `room_id`. Tournament orchestration only assigns which bracket match that room should play; dart injection is unchanged.
