# Board station scripts

Double-click **`start-board.bat`** on the Windows mini-PC to start:

1. Autodarts Board Manager (if configured)
2. Autodarts -> No3 companion bridge (kills any old bridge PID first - required after takeout/seat-lock fixes)
3. Optional TV kiosk + iPad play URL printout

Copy `config.example.yaml` -> `config.yaml` and set No3 URL/room. If `autodarts.exe_path` is empty, Start-Board searches common install locations (Program Files, Desktop .lnk, AppData, Start Menu) and saves a hit back into config.

Exit codes: `0` ok, `1` script error (photo the window), `3` Autodarts API down and no exe/.lnk found.

Full bar ops guide: [`docs/BOARD-STATION.md`](../../docs/BOARD-STATION.md).
