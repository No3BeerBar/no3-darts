# Timed challenges (MVP)

No.3 timed challenges award **points for uncorrected accomplishments** during a window (e.g. double-out 80+, 3 bulls). Definitions are synced from **No3Passport**; scoring and standings live in **no3-darts**. Passport owns announcement UI and reads standings via the integration APIs below.

Companion Passport work (UI, challenge authoring, winner banners) is separate — this app exposes clear integration APIs and scores at match persist.

## Product rules

- Highly variable goals with point values and stack modes (`once` | `every`).
- **ONLY uncorrected visits count.** Undo / Correct / Edit visit mark the visit (and its darts) as `edited`; challenge evaluation skips them.
- Guests and bots **never** score. Registered PIN players only.
- **No polling boards.** Credits run inside `persistFinishedMatch` from the final in-memory `GameState.turns` on the `StoredMatch` payload. `summaryJson` stays thin (unchanged).
- Auto-mark accomplishments, tally points, expose leaderboard; winner is the top standing (Passport announces).

## Uncorrected semantics

Today Undo/Correct rewrite turns. The engine now stamps durable flags:

| Field | Where | Meaning |
|-------|--------|---------|
| `GameState.currentVisitEdited` | open visit | visit was rewritten; cleared when the visit finalizes |
| `Turn.edited` | completed visit | void for challenge credit |
| `DartThrow.edited` | dart on an edited visit | void for dart-level goals |

Set by `correctCurrentTurn`, `editLastTurn`, and `undo` (which uses those paths). Flags are preserved through later rewrites of the same visit.

Evaluation also skips visits that contain any `source === "bot"` dart.

## Rule engine

Pure module: `src/lib/challenges/rules.ts` (+ tests).

Goal shape:

```json
{ "id": "g1", "ruleType": "bull", "params": { "count": 3 }, "points": 10, "stack": "every" }
```

| ruleType | Params | Behavior |
|----------|--------|----------|
| `bull` | `includeOuter?: boolean`, `count?: number` | Count `kind === "bull"` (optionally `outer_bull`). If `count` set: `every` → `floor(hits/count)` awards; `once` → one award when `hits >= count`. Without `count`: each hit is an occurrence (`once` → any hit awards once). |
| `checkout_min` | `min`, `requireDoubleOut?` | `Turn.checkout` and visit value ≥ min; optional last dart double/bull |
| `visit_score` | `min` | Non-bust visit total ≥ min |
| `one_eighty` | — | Visit total === 180 |
| `segment_hit` | `kind`, `number?` | Hits of segment kind (+ number for 1–20) |
| `match_win` | — | Player is `winnerId` |
| `legs_won` | — | `playerStates.legsWon` |

`evaluateChallengeGoals(state, playerId, goals)` → `{ goalId, points, occurrences, evidence? }[]`.

## Persistence

Tables (Drizzle + `ensureSchema` auto-create):

| Table | Purpose |
|-------|---------|
| `challenges` | id, name, startsAt, endsAt, status (`active` \| `closed`) |
| `challenge_goals` | rule defs for a challenge (replaced on upsert) |
| `challenge_progress` | per player cumulative points + breakdown JSON |
| `challenge_match_credits` | unique `(matchId, challengeId, playerId)` idempotency ledger |

Hook: after a successful match insert in `persistFinishedMatch` (and on idempotent re-persist), `creditChallengesForMatch` loads active challenges whose window contains `finishedAt`, evaluates each registered player, inserts credit rows, and upserts progress.

## Integration APIs (Passport)

Auth: `Authorization: Bearer $PASSPORT_DARTS_SHARED_SECRET`  
Reuse `src/lib/auth/passport.ts` (same as link-challenge). No session cookies.

| Method | Path | Purpose |
|--------|------|---------|
| `PUT` | `/api/integrations/passport/challenges` | Upsert challenge + goals |
| `GET` | `/api/integrations/passport/challenges/active` | List in-window active challenges |
| `GET` | `/api/integrations/passport/challenges/:id/standings` | Leaderboard + `winner` |
| `POST` | `/api/integrations/passport/challenges/:id/close` | Freeze (`closed`) + return standings/winner |

### Upsert body example

```json
{
  "id": "chal_aug_bulls",
  "name": "August Bull Rush",
  "startsAt": "2026-08-01T00:00:00.000Z",
  "endsAt": "2026-08-31T23:59:59.000Z",
  "status": "active",
  "goals": [
    { "id": "g_3bull", "ruleType": "bull", "params": { "count": 3 }, "points": 15, "stack": "every" },
    { "id": "g_co80", "ruleType": "checkout_min", "params": { "min": 80, "requireDoubleOut": true }, "points": 20, "stack": "every" }
  ]
}
```

## Public / TV-friendly APIs

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/challenges` | Active window list (`?all=1`, `?closed=1`) |
| `GET` | `/api/challenges/:id` | Detail + standings (`?standings=0` to omit) |

Registered progress only (no guests/bots).

## Env

Reuses **`PASSPORT_DARTS_SHARED_SECRET`** (no new required vars). See `.env.example` and [`PLAYERS.md`](./PLAYERS.md).

## Smoke test plan

1. Set `PASSPORT_DARTS_SHARED_SECRET` and `DATABASE_URL`; restart app.
2. `PUT /api/integrations/passport/challenges` with Bearer + sample body → `200` + challenge.
3. `GET /api/integrations/passport/challenges/active` → includes the challenge when `now` is in window.
4. Play a match as a registered PIN player; hit a goal **without** undo/correct → finish match → persist.
5. `GET .../challenges/:id/standings` → player has points.
6. Replay persist (same match id) → points unchanged (idempotent).
7. Play again; undo mid-visit then re-score the same accomplishment → **no** additional credit for that visit.
8. Guest-only / bot match → no challenge progress rows.
9. `POST .../challenges/:id/close` → status `closed`, winner returned; further finishes in window do not score.
10. `npm test` includes `src/lib/challenges/rules.test.ts` and `src/engine/edited-visit.test.ts`.
