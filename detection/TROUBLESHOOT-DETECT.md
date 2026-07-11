# Detector not scoring — checklist

## Which window is which?

| Window | Role |
|--------|------|
| **Black CMD** (`run-detector.bat`) | **Console** — all logs / POST messages |
| **No3 · cam0** (video) | Live camera + red motion overlay |
| **Mask · cam0** (B&W) | What the detector thinks changed |

## Force test (do this first)

1. `git pull` in `no3-darts`, then `.\scripts\run-detector.bat`
2. Click a **camera** window (not the black console)
3. **Empty** the board → press **`B`**
4. Put a dart **in the board** (by hand is fine)
5. Press **`T`** (force detect)

**Black console should say** something like:

```
T: force detect ...
cam0 FORCE HIT single 20 ...
POST dart single 20 → {...}
```

### If FORCE works but auto throw does not
Auto settle is still finicky — use lighting / sensitivity tweaks below. FORCE proves cameras + calib + API work.

### If FORCE says `no tip found`
- Grey circle on video must sit on the **board** (center + outer wire). If not → re-calibrate.
- Mask window after T should show **white blob** where the dart is. If all black → motion threshold too high or dart not visible.
- In `config.yaml` set:
  ```yaml
  motion_threshold: 5
  min_motion_pixels: 10
  ```

### If POST fails
- Check `no3_api_url` in `config.yaml` (Railway URL)
- Console should say `API health OK` at start

### If POST works but iPad/TV does not change
- Start a **match** on the tablet for the same `room_id` (e.g. `Board 1`)
- Console should say `Active match found` (or start a game then throw again)

## Keys (click camera window first)

| Key | Action |
|-----|--------|
| **B** | Lock empty-board background |
| **T** | Force-detect dart vs that background |
| **D** | Toggle dry-run |
| **Q** | Quit |

## Update config sensitivity

Your old `config.yaml` may still have high thresholds. Edit or copy from `config.example.yaml`:

```yaml
motion_threshold: 8
min_motion_pixels: 25
min_confidence: 0.30
```

## Re-calibrate one camera

```powershell
cd C:\No3Darts\no3-darts\detection
.\.venv\Scripts\python.exe -m no3_detect calibrate-vision --camera 0 --id cam0 --out .\calib\cam0.json --method vision-or-auto
```

Circle must match the outer double. Press **y** to save.
