# Board 1 QA - critical smoke (John)

Two P0 checks after any Board 1 / camera-bridge change or mini-PC restart.
Full wiring: `docs/BOARD-STATION.md`.

## Restart (mini-PC)

1. Cams + ring light on.
2. Run `Board1-Setup.bat` or `start-board.bat` (kit / `tools/board-station`).
3. If the board is stuck (bridge dead, takeout wedged, TV blank): double-click `Board1-FixMe.bat` from `/board-setup` or `C:\No3Darts\Board1\` - same one-file recovery as Setup, without wiping `exe_path`.
4. Board Manager detecting at `http://127.0.0.1:3180`.
5. Companion bridge window stays open (`python -m companion bridge`).

## P0-1 - Takeout / removing darts + Reset

1. Start a match on iPad `/play?room=Board%201`.
2. Throw until Autodarts enters **Takeout / Removing darts**.
3. iPad shows **Removing darts - takeout** with a **Reset takeout** button (not a dead banner).
4. Scoring stays paused while takeout is active.
5. Pull darts, tap **Reset takeout** - bridge resets; next visit can start clean.
6. Companion log: `takeout` / `takeout-ready` / `takeout reset` / `next visit ready`.

## P0-2 - Dart 3 never jumps seats

1. Throw a full 3-dart visit (let dart 3 lag if it usually does).
2. All three darts must score on the **same** seat.
3. Dart 3 must **never** appear as the first dart of the next player.
4. Companion log: three `AD ... -> No3` lines on one seat index, then end-turn / visit closed - **not** end-turn after dart 2.

If either P0 fails: stop bar play, redeploy kit/bridge from main, re-run:

```bash
npm test
cd tools/autodarts-companion && python3 -m pytest -q
```
