# Board 1 QA - 5-minute smoke (John)

Do this after any Board 1 / camera-bridge change, kit redeploy, or mini-PC restart.
Full wiring: `docs/BOARD-STATION.md`. Automated net: `npm run test:board1`.

## 0. Restart (mini-PC) - 60s

1. Cams + ring light on.
2. Prefer `Board1-FixMe.bat` if anything is wedged (bridge dead, takeout stuck, TV blank).
   Fix Me **always** re-downloads the kit zip (keeps `config.yaml` / `.venv`) so a
   stale companion without `expectedPlayerIndex` cannot keep running.
   Otherwise `Board1-Setup.bat` / `start-board.bat` from the kit.
3. Board Manager detecting at `http://127.0.0.1:3180`.
4. Companion bridge window stays open (`python -m companion bridge`).
5. iPad: `/play?room=Board%201`. TV: `/tv`.

## 1. Takeout / removing darts + Reset - 60s

1. Start any mode on **Board 1** (guest + bot is fine).
2. Throw until Autodarts enters **Takeout / Removing darts / Hand**.
3. iPad shows **Removing darts - takeout** with a working **Reset takeout** button.
4. **TV (`/tv`)** shows a big yellow **Removing darts** banner telling patrons
   to pull darts and tap **Reset** on the scoring tablet — impossible to miss
   from across the bar. Banner clears when takeout clears.
5. Camera scoring stays paused (no late dart onto the next seat).
6. Pull darts, tap **Reset** - iPad + TV banners clear; next visit can start.
7. Companion log: `takeout` / `takeout-ready` / `end-turn ... seat=` / `next visit ready`.
8. **Takeout finished** must not leave Pull-darts stuck forever.
9. Sandbox / no Autodarts / AD offline: no Pull-darts banner on iPad **or TV**
   and no looping "Ready for next visit" toast. Manual board taps still score.

## 2. Dart 3 never jumps seats - 90s

1. Throw a full 3-dart visit (let dart 3 lag if it usually does).
2. All three score on the **same** seat.
3. Dart 3 must **never** appear as the next player's first dart.
4. Companion: three `AD ... -> No3` lines on one seat index, then end-turn with
   `expectedPlayerIndex` - **not** end-turn after dart 2.

## 3. Undo + resume PIN - 60s

1. Tap **Undo** a few times - scores step backward dart-by-dart (no staff unlock).
2. After a closed visit, Undo must not leave camera stuck on takeout hold.
3. Kill/reopen the iPad browser with a registered seat in the match -
   **PIN required** before scoring resumes (guests stay open).

## 4. No mid-game board reset / no Sigma banner - 30s

1. During a live `playing` match, companion must **not** log between-games
   `recal` / "Board reset between games".
2. No per-dart running-sum / Sigma callout banner after each throw
   (seat scores still update).

## 5. Fail closed (quick log glance) - 30s

If something races, bridge / server should refuse wrong-seat posts:

- `expectedPlayerIndex` on dart / end-turn / correct
- `end-turn blocked` when seat unknown (never omit the field)
- Server 409: seat mismatch / takeout hold / takeout active

## Stop conditions

If takeout sticks, dart 3 jumps seats, Undo wedges scoring, or mid-match recal
fires: stop bar play, redeploy kit/bridge from main, re-run:

```bash
npm run test:board1
npm test
cd tools/autodarts-companion && python3 -m pytest -q
```
