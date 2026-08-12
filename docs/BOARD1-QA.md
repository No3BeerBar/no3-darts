# Board 1 QA (5-minute bar smoke)

Short checklist for John after a Board 1 / camera-bridge change or mini-PC restart.
Full wiring: `docs/BOARD-STATION.md`. Automated net: `src/lib/board1-acceptance.test.ts` + companion `tests/test_board1_acceptance.py`.

## Restart (mini-PC)

1. Cams + ring light on.
2. If needed: download/run `Board1-Setup.bat` once, or double-click `start-board.bat` from the kit / `tools/board-station`.
3. If the board is stuck (bridge dead, takeout wedged, TV blank): double-click `Board1-FixMe.bat` from `/board-setup` or `C:\No3Darts\Board1\` — same one-file recovery as Setup, without wiping `exe_path`.
4. Confirm Autodarts Board Manager is detecting (`http://127.0.0.1:3180`).
5. Companion bridge window should stay open (`python -m companion bridge`).

## iPad + TV

1. iPad: open `/play?room=Board%201` (bookmark). Start any mode on **Board 1**.
2. TV: `/tv` — attract when idle; live scores when the match is up.
3. Throw a full 3-dart visit. All three must land on the **same** seat (never dart 3 on the next player).
4. During takeout: iPad shows **Pull darts — takeout**; scoring paused until Ready / clean board.
5. Tap **Undo** a few times — scores step backward dart-by-dart (no staff unlock needed).
6. Kill/reopen the iPad browser (or clear apps) with a registered seat in the match — **PIN required** before scoring resumes.
7. No flashy per-dart callout / Sigma banner after each throw (scores still update on the seat).

## Companion logs (watch for)

In the bridge window, healthy flow looks like:

- Dart posts for throw 1/2/3 on one seat, then end-turn (not end-turn after dart 2).
- Seat lock / `expectedPlayerIndex` — refuse wrong-seat posts if something races.
- Takeout: scoring frozen; no dart/correct spam mid-pull.
- **No** `recal` / "Board reset between games" while a match status is `playing`.
- Health: FPS/unhealthy toasts only when cams actually die; auto-restart then recovers.

If dart 3 jumps seats, takeout scores mid-pull, or recal fires mid-match — stop and check bridge version + `npm test` / companion pytest before more bar play.

## Automated

```bash
npm test
cd tools/autodarts-companion && pip install -r requirements-dev.txt && python -m pytest -q
```
