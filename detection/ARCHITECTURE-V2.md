# No3 Detection Architecture v2

## Why v1 failed

| v1 approach | Problem |
|-------------|---------|
| Circle polar in image space | Wrong under oblique cameras |
| Free ellipse fit from edges / many clicks | Center ≠ bull; cumbersome; unstable |
| Segment majority vote across cams | Votes wrong geometry, doesn’t average position |
| Grok for landmarks | Slow, flaky API, not how production scorers work |

## How real systems work

### Autodarts (production DIY standard)
- **3 cameras** ~120° apart on a **360° LED ring** (even light, no shadows).
- **Calibration**: few fixed reference points on the board + auto-calibrate option; software also **undistorts** lenses (v0.24+).
- **Detection**: **motion / pixel change** when a dart arrives; per-camera dart views for debug.
- **Takeout**: separate board state (throw vs remove darts).
- Hardware rigidity matters more than clever CV.

Sources: [autodarts.diy](https://autodarts.diy/), [Autodarts Desktop overview](https://autodarts.diy/Autodarts-Desktop/Overview/), product claims ~99% with Vantage kit.

### DeepDarts (research, single cam, strong geometry)
- Detect **4 calibration keypoints** on the **outer double wire** at segment boundaries:
  - **20/5**, **6/13**, **3/17**, **11/8**
- Build **homography** image → ideal board plane.
- Detect **dart tip** in image → map through H → **polar score** on standard board radii.
- ~95% PCS face-on with learned keypoints; multi-cam commercial systems use similar plane mapping + motion.

Paper: McNally et al., *DeepDarts* (arXiv:2105.09880).

### Open-source OpenCV scorers
- [opencv-steel-darts](https://github.com/hanneshoettinger/opencv-steel-darts): ellipse→circle affine, wire intersections → H to ideal board; frame-diff darts; multi-cam score merge.
- [vassdoki/opencv-darts](https://github.com/vassdoki/opencv-darts): side cameras + **triangulation**.
- DIY Autodarts community: OV9732 cams, ring light, Pi/NUC.

## v2 design (what we build)

### 1. Geometry (foundation)
- Ideal board plane: unit circle, outer double at r=1, WDF radii.
- **Per camera**: 4-point homography  
  `image (u,v) ↔ board (x,y)` with destination points at  
  angles for **20/5, 6/13, 3/17, 11/8** on the unit circle.
- Tip score only after mapping to board plane. **Never** polar in raw image pixels.

### 2. Calibration UX
**Default: fully automatic (no clicks)** — `v2-auto-calibrate`

1. Grab frame  
2. **Grok vision** (if `XAI_API_KEY`) returns outer-double points at 20, 6, 3, 11  
3. Else **OpenCV** outer ellipse + 4 cardinals (20 ≈ image-up)  
4. Homography → validate → save  

Manual 4-click remains as fallback: `v2-calibrate`.

### 3. Detection
1. Lock empty-board background (B).  
2. Motion spike → settle.  
3. Diff blob → tip (point on blob nearest board-plane center after H, or image center mapped).  
4. Map tip → board (x,y).  
5. **Fuse multi-cam** as mean of board (x,y) weighted by confidence (not segment voting).  
6. `score(x,y)` via polar on ideal board.  
7. Takeout: large motion / board returns near empty → end visit / next player.

### 4. Hardware expectations (document, not software-only)
- 3 cams, rigid mounts, same USB ports always.  
- Even ring lighting (critical).  
- Lenses with low distortion; software undistort if calibrated.

### 5. Optional later
- YOLO tip + 4 calib points (DeepDarts path).  
- Grok vision only as rare assist, not core loop.  
- True stereo triangulation if cams look along board horizon.

## Module map (v2)

```
detection/no3_detect/v2/
  board_plane.py    # WDF radii, score from board (x,y)
  cam_calib.py      # 4-pt H, save/load JSON
  auto_calibrate.py # NO-CLICK auto (Grok + OpenCV)
  calibrate_ui.py   # optional 4-click UI + warp preview
  tip_detect.py     # background diff → tip pixel
  pipeline.py       # multi-cam loop, fuse, takeout, POST
```

CLI:
```
# Recommended (autonomous, no clicks):
python -m no3_detect v2-auto-calibrate --cameras 0 1 2 --ids cam0 cam1 cam2 --outdir ./calib -y
python -m no3_detect v2-run --config config.yaml

# Optional manual 4-click fallback:
python -m no3_detect v2-calibrate --camera 0 --id cam0 --out calib/cam0.json
```

## Migration
- Keep v1 code temporarily; default bats use **v2**.  
- Old ellipse/Grok calib files are incompatible; re-calibrate with 4 clicks.
