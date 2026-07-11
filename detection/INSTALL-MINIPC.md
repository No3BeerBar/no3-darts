# Mini-PC install (Windows) — one command

After this repo is on GitHub, on the **Windows mini PC** open **PowerShell** and run:

```powershell
# Allow scripts for this session (once)
Set-ExecutionPolicy -Scope Process Bypass

# Install everything
irm https://raw.githubusercontent.com/No3BeerBar/no3-darts/main/detection/scripts/install-from-github.ps1 | iex
```

The script will ask for your **No3 Darts URL** (Railway URL) if you don’t pass parameters.

### With parameters (no prompts)

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/No3BeerBar/no3-darts/main/detection/scripts/install-from-github.ps1))) `
  -ApiUrl "https://YOUR-APP.up.railway.app" `
  -RoomId "Board 1" `
  -CameraApiKey ""
```

### What it does
1. Checks/installs path to Python + Git (offers winget if missing)
2. Clones or updates `C:\No3Darts\no3-darts`
3. Creates `.venv` and installs OpenCV + deps
4. Writes `detection\config.yaml`
5. Runs a geometry self-test
6. Puts **Desktop shortcuts**: Detector + Calibrate

### After install
1. Double-click **No3 Calibrate Cameras**
2. Double-click **No3 Darts Detector**
3. iPad + TV: same room name as `room_id` in config

### Update later
Re-run the same `irm ... | iex` command, or:

```powershell
cd C:\No3Darts\no3-darts
git pull
cd detection
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Full details: [WINDOWS.md](./WINDOWS.md)
