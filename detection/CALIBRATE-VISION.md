# Smarter board calibration

You no longer have to click center / radius / 20 by hand (though that still works).

## Methods

| Method | Command | Needs |
|--------|---------|--------|
| **Grok vision** (recommended) | `calibrate-vision --method vision` | `XAI_API_KEY` from [console.x.ai](https://console.x.ai/) |
| **OpenCV auto** | `calibrate-vision --method auto` | Free, offline |
| **Hybrid** | `calibrate-vision --method vision-or-auto` | Tries Grok, falls back to OpenCV |
| **Manual** | `calibrate` | Mouse + keys |

Grok vision finds bull, outer double, **20**, and (when possible) four points on the outer double at 20/6/3/11. OpenCV then fits an **ellipse** and builds a **perspective homography** so **oblique / side-mounted cameras** score correctly (plain circle math is wrong when the board looks elliptical).

Uses model **`grok-4.5`** via `https://api.x.ai/v1/responses`. Override with env `XAI_VISION_MODEL` if needed.

After calibration, check the overlay: you should see an **ellipse** on the outer double (not a circle) and `model=ellipse` or `model=homography` in the detector.

### API error codes

| Code | Meaning |
|------|---------|
| **401** | Wrong or missing API key |
| **400** | Bad request (old/retired model name, bad image payload) — **not** usually the key |
| **403** | Key lacks access to that model/endpoint |

---

## Mini PC (Windows)

### 1. Pull latest code
```powershell
cd C:\No3Darts\no3-darts
git pull
cd detection
.\.venv\Scripts\Activate.ps1
```

### 2. Set your xAI key (for Grok vision)
```powershell
setx XAI_API_KEY "xai-your-key-here"
```
Close PowerShell and open a **new** window so the key is loaded.

### 3. Run vision calibration (all 3 cams)
```powershell
cd C:\No3Darts\no3-darts\detection
.\.venv\Scripts\Activate.ps1

python -m no3_detect calibrate-vision --cameras 0 1 2 --ids cam0 cam1 cam2 --outdir .\calib --method vision-or-auto
```

Or double-click: `scripts\calibrate-vision.bat`

For each camera you’ll see an overlay (center + radius + “20” line). Press **`y`** to save or **`n`** to discard.

### 4. OpenCV only (no API key)
```powershell
python -m no3_detect calibrate-vision --cameras 0 1 2 --ids cam0 cam1 cam2 --outdir .\calib --method auto -y
```
Note: auto mode assumes **20 is near the top of the image**. If your cams are rotated, use Grok vision or manual `t` key to set rotation.

### 5. Restart detector
```powershell
.\scripts\run-detector.bat
```
Empty board → press **`b`** in a preview window → throw.

---

## One camera example
```powershell
python -m no3_detect calibrate-vision --camera 0 --id cam0 --out .\calib\cam0.json --method vision --api-key "xai-..."
```

---

## Tips
- Good lighting, full board in frame, no person in front of the board when grabbing the snapshot  
- If Grok’s circle is slightly off, run interactive `calibrate` to fine-tune that cam  
- Snapshots are saved next to JSON as `cam0.jpg` for debugging  
