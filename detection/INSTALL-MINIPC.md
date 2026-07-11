# Mini-PC install (Windows) — one command

On the **Windows mini PC** open **PowerShell** and run:

```powershell
# Allow scripts for this session
Set-ExecutionPolicy -Scope Process Bypass

# Install everything (will offer to install Python automatically if missing)
irm https://raw.githubusercontent.com/No3BeerBar/no3-darts/main/detection/scripts/install-from-github.ps1 | iex
```

When it asks **Install Python 3.12 automatically?** type **Y** and Enter.

If Python was just installed and still not found: **close PowerShell completely**, open a **new** window, and run the same two lines again.

The script will also ask for your **No3 Darts URL** (Railway URL) if you don’t pass parameters.

### If Python still fails (manual)

1. Download: https://www.python.org/downloads/windows/ → **Python 3.12 64-bit**
2. Run installer — **must check** ☑ **Add python.exe to PATH**
3. Click Install Now
4. **Close all PowerShell windows**, open a new one
5. Run:

```powershell
python --version
```

You should see `Python 3.12.x`. Then re-run the install one-liner above.

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
