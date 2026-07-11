# Windows mini-PC setup (No3 detector)

Use this on each bar mini PC that has **3 fixed cameras**.  
The **web app** can stay on Railway — you only need Python + this `detection` folder on Windows.

---

## 1. One-time OS prep

1. Windows 10/11, fully updated.
2. Plug the PC into power; set power plan so it **never sleeps** when plugged in:
   - **Settings → System → Power → Screen and sleep** → both “Never” when plugged in.
3. Plug all **3 cameras** into the same USB ports every time (order matters for indices 0/1/2).
4. Open the **Camera** app and confirm each camera works (switch between them if needed).

Optional: give the PC a static LAN name, e.g. `NO3-BOARD1`.

---

## 2. Install Python

1. Download **Python 3.11 or 3.12** (64-bit) from [https://www.python.org/downloads/windows/](https://www.python.org/downloads/windows/)
2. Run the installer and check:
   - **☑ Add python.exe to PATH**
   - **☑ Install pip**
3. Open a **new** PowerShell window and verify:

```powershell
python --version
pip --version
```

You should see Python 3.11+ (or 3.12+). If `python` is not found, try `py --version` and use `py` below instead of `python`.

---

## 3. Get the detection code onto the PC

**Option A – Git (recommended if you update often)**

```powershell
# Install Git for Windows if needed: https://git-scm.com/download/win
cd $env:USERPROFILE
git clone <YOUR_REPO_URL> grokDartsScoring
cd grokDartsScoring\detection
```

**Option B – Copy folder**

Copy the whole `detection` folder (from the repo) to e.g.:

`C:\No3Darts\detection`

Then:

```powershell
cd C:\No3Darts\detection
```

---

## 4. Automated setup (venv + packages)

In PowerShell (in the `detection` folder):

```powershell
# If scripts are blocked once:
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

.\scripts\setup-windows.ps1
```

Or manually:

```powershell
cd C:\No3Darts\detection   # or your path

python -m venv .venv
.\.venv\Scripts\Activate.ps1

python -m pip install --upgrade pip
pip install -r requirements.txt
# GUI for calibration + preview (replaces headless OpenCV):
pip uninstall -y opencv-python-headless
pip install opencv-python

copy config.example.yaml config.yaml
```

---

## 5. Edit `config.yaml`

Open `config.yaml` in Notepad and set:

```yaml
no3_api_url: "https://YOUR-APP.up.railway.app"
camera_api_key: ""              # set if Railway has CAMERA_API_KEY
room_id: "Board 1"              # unique per board, e.g. Board 2

preview: true                   # true while setting up; false for kiosk
dry_run: false

cameras:
  - id: cam0
    source: 0
    enabled: true
    calibration: "./calib/cam0.json"
  - id: cam1
    source: 1
    enabled: true
    calibration: "./calib/cam1.json"
  - id: cam2
    source: 2
    enabled: true
    calibration: "./calib/cam2.json"
```

### Finding camera indices (0, 1, 2)

If the wrong camera opens during calibrate:

```powershell
.\.venv\Scripts\Activate.ps1
python -m no3_detect list-cameras
```

Swap `source: 0/1/2` in `config.yaml` until each physical camera matches.

**Tip:** Always use the same USB ports so indices stay stable after reboot.

---

## 6. Calibrate (once per camera)

Empty the board. Activate venv, then:

```powershell
.\.venv\Scripts\Activate.ps1

python -m no3_detect calibrate --camera 0 --id cam0 --out .\calib\cam0.json
python -m no3_detect calibrate --camera 1 --id cam1 --out .\calib\cam1.json
python -m no3_detect calibrate --camera 2 --id cam2 --out .\calib\cam2.json
```

| Key | Action |
|-----|--------|
| Mouse | Crosshair |
| `c` | Board **center** (bull) |
| `r` | **Outer double** wire under mouse |
| `t` | Point at middle of segment **20** |
| `s` | Save |
| `q` | Quit |

A window must open (needs `opencv-python`, not headless).

---

## 7. Test API + run live

1. On a tablet/phone, open the No3 site and **start a match**.
2. Admin → room name must match `room_id` (e.g. `Board 1`).
3. On the mini PC:

```powershell
cd C:\No3Darts\detection
.\.venv\Scripts\Activate.ps1

# Optional: fake T20 T20 T20 (match must be running)
python -m no3_detect simulate --url https://YOUR-APP.up.railway.app --180

# Live detection
python -m no3_detect run --config config.yaml
```

- Three preview windows (if `preview: true`).
- Press **`b`** to reset background (empty board).
- Press **`q`** to quit.
- For production without windows: `python -m no3_detect run --config config.yaml --no-preview`

---

## 8. Auto-start on login (recommended)

### Easy: Startup folder shortcut

1. Run:

```powershell
.\scripts\install-autostart.ps1
```

This creates a Startup shortcut that runs `run-detector.bat` when the bar user logs in.

### Manual

1. `Win + R` → `shell:startup`
2. Create a shortcut to `C:\No3Darts\detection\scripts\run-detector.bat`

Ensure Windows **auto-login** for the bar user if you want unattended boot (optional, bar policy decision).

---

## 9. Daily use

| Step | Who |
|------|-----|
| PC boots, detector starts | Automatic if Startup installed |
| Open No3 on tablet, start match, room = `Board 1` | Staff |
| Throw darts | Guests |
| Remove darts / weird scores | Press `b` in detector window, or restart `run-detector.bat` |
| Cameras moved | Re-run calibrate for that camera |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `python` not found | Reinstall Python with “Add to PATH”, open **new** PowerShell |
| `Activate.ps1` blocked | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| No camera window / black | Another app using the camera (close Camera app, Zoom, etc.) |
| Wrong camera for cam0 | Change `source` in config; run `list-cameras` |
| Indices change after reboot | Same USB ports; or lock ports / use USB hub in fixed order |
| API / simulate fails | Check `no3_api_url`, firewall, `CAMERA_API_KEY` |
| OpenCV GUI missing | `pip install opencv-python` (not only headless) |
| Detection too sensitive | Raise `motion_threshold` in config |
| Misses soft throws | Lower `motion_threshold`, improve lighting |

Firewall: outbound HTTPS to Railway is enough. No inbound ports required on the mini PC.

---

## Quick reference paths

```
C:\No3Darts\detection\
  config.yaml
  calib\cam0.json, cam1.json, cam2.json
  .venv\
  scripts\setup-windows.ps1
  scripts\run-detector.bat
  scripts\install-autostart.ps1
```
