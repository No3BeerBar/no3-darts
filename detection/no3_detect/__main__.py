"""
CLI entrypoint:

  .venv\\Scripts\\python.exe -m no3_detect calibrate --camera 0 --id cam0 --out ./calib/cam0.json
  .venv\\Scripts\\python.exe -m no3_detect run --config config.yaml
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def _check_deps() -> None:
    """Fail fast with the exact fix command if cv2/rich missing."""
    missing = []
    try:
        import cv2  # noqa: F401
    except ImportError:
        missing.append("cv2 (package: opencv-python)")
    try:
        import rich  # noqa: F401
    except ImportError:
        missing.append("rich")
    try:
        import yaml  # noqa: F401
    except ImportError:
        missing.append("yaml (package: PyYAML)")
    try:
        import requests  # noqa: F401
    except ImportError:
        missing.append("requests")
    if not missing:
        return
    exe = sys.executable
    print("=" * 60, file=sys.stderr)
    print("Missing Python packages:", ", ".join(missing), file=sys.stderr)
    print(f"This Python is: {exe}", file=sys.stderr)
    print(file=sys.stderr)
    print("Fix (from the detection folder):", file=sys.stderr)
    print("  scripts\\fix-deps.bat", file=sys.stderr)
    print(file=sys.stderr)
    print("Then always use the venv python, not bare 'python':", file=sys.stderr)
    print("  .venv\\Scripts\\python.exe -m no3_detect ...", file=sys.stderr)
    print("  scripts\\run-detector.bat", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    sys.exit(1)


_check_deps()

from rich.console import Console  # noqa: E402

console = Console()


def cmd_calibrate(args: argparse.Namespace) -> None:
    from .calibration import interactive_calibrate

    interactive_calibrate(
        source=args.camera,
        camera_id=args.id,
        out_path=args.out,
    )


def cmd_calibrate_vision(args: argparse.Namespace) -> None:
    """Calibrate with Grok vision and/or OpenCV auto."""
    import os

    from .vision_calibrate import DEFAULT_VISION_MODEL, run_vision_calibrate

    method = args.method
    model = args.model or os.environ.get("XAI_VISION_MODEL") or DEFAULT_VISION_MODEL
    cams = args.cameras if args.cameras else [args.camera]
    ids = args.ids if args.ids else ([args.id] if len(cams) == 1 else [f"cam{i}" for i in range(len(cams))])
    if len(ids) != len(cams):
        console.print("[red]--ids count must match --cameras[/red]")
        sys.exit(1)

    Path(args.outdir).mkdir(parents=True, exist_ok=True)

    for cam, cid in zip(cams, ids):
        out = args.out if len(cams) == 1 else str(Path(args.outdir) / f"{cid}.json")
        console.print(f"\n[bold]Calibrating {cid} (source={cam}) method={method}[/bold]")
        try:
            run_vision_calibrate(
                source=cam,
                camera_id=cid,
                out_path=out,
                api_key=args.api_key or None,
                model=model,
                method=method,
                confirm=not args.yes,
            )
        except Exception as e:
            console.print(f"[red]{cid} failed: {e}[/red]")
            if not args.continue_on_error:
                sys.exit(1)


def cmd_run(args: argparse.Namespace) -> None:
    from .pipeline import DetectionPipeline, PipelineConfig

    cfg_path = Path(args.config)
    if not cfg_path.exists():
        console.print(
            f"[red]Config not found: {cfg_path}[/red]\n"
            "Copy config.example.yaml → config.yaml and calibrate cameras."
        )
        sys.exit(1)
    config = PipelineConfig.load(cfg_path)
    if args.dry_run:
        config.dry_run = True
    if args.no_preview:
        config.preview = False
    pipeline = DetectionPipeline(config)
    pipeline.run()


def cmd_v2_calibrate(args: argparse.Namespace) -> None:
    from .v2.calibrate_ui import interactive_calibrate_v2

    interactive_calibrate_v2(
        source=args.camera,
        camera_id=args.id,
        out_path=args.out,
    )


def cmd_v2_auto_calibrate(args: argparse.Namespace) -> None:
    """No-click auto calibration (Grok optional + OpenCV)."""
    import os

    from .v2.auto_calibrate import DEFAULT_VISION_MODEL, auto_calibrate_camera

    model = args.model or os.environ.get("XAI_VISION_MODEL") or DEFAULT_VISION_MODEL
    sources = args.cameras if args.cameras else [args.camera]
    ids = args.ids if args.ids else [args.id]
    if len(ids) < len(sources):
        ids = [f"cam{i}" for i in range(len(sources))]

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    for src, cid in zip(sources, ids):
        out = outdir / f"{cid}.json" if args.cameras else Path(args.out)
        console.print(f"\n[bold]Auto-calibrate {cid} ← {src}[/bold]")
        try:
            auto_calibrate_camera(
                source=src,
                camera_id=cid,
                out_path=out,
                api_key=args.api_key or None,
                model=model,
                prefer_grok=not args.opencv_only,
                show_preview=not args.yes,
                auto_save=args.yes,
            )
        except Exception as e:
            console.print(f"[red]{cid} failed: {e}[/red]")
            if not args.continue_on_error:
                sys.exit(1)


def cmd_v2_run(args: argparse.Namespace) -> None:
    from .v2.pipeline import V2Config, V2Pipeline

    cfg_path = Path(args.config)
    if not cfg_path.exists():
        console.print(f"[red]Config not found: {cfg_path}[/red]")
        sys.exit(1)
    config = V2Config.load(cfg_path)
    if args.dry_run:
        config.dry_run = True
    if args.no_preview:
        config.preview = False
    V2Pipeline(config).run()


def cmd_simulate(args: argparse.Namespace) -> None:
    from .api_client import No3Client
    from .simulate import classic_180_sequence, run_simulation

    client = No3Client(args.url, api_key=args.api_key or "", room_id=args.room)
    seq = classic_180_sequence() if args.one_eighty else None
    run_simulation(
        client,
        count=args.count,
        delay_s=args.delay,
        dry_run=args.dry_run,
        sequence=seq,
    )


def cmd_list_cameras(_: argparse.Namespace) -> None:
    """Probe camera indices 0–9 so Windows USB order can be mapped in config.yaml."""
    import cv2

    console.print("[bold]Probing camera indices 0–9[/bold] (open windows briefly)…")
    found = []
    for i in range(10):
        cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)  # CAP_DSHOW is more reliable on Windows
        if not cap.isOpened():
            cap.release()
            cap = cv2.VideoCapture(i)
        if not cap.isOpened():
            continue
        ok, frame = cap.read()
        if ok and frame is not None:
            h, w = frame.shape[:2]
            found.append(i)
            console.print(f"  [green]index {i}[/green]  {w}x{h}")
            # brief preview
            win = f"camera index {i} — press any key"
            cv2.imshow(win, frame)
            cv2.waitKey(800)
            cv2.destroyWindow(win)
        cap.release()
    cv2.destroyAllWindows()
    if not found:
        console.print("[red]No cameras found. Close other apps using the cameras and retry.[/red]")
        sys.exit(1)
    console.print(f"\nUse these as [cyan]source:[/cyan] values in config.yaml: {found}")


def cmd_test_geometry(_: argparse.Namespace) -> None:
    from .board_geometry import BOARD_ORDER, angle_for_number, number_at_angle, polar_to_segment

    assert number_at_angle(0) == 20
    assert number_at_angle(angle_for_number(5)) == 5
    t20 = polar_to_segment(0.60, 0.0)
    assert t20.kind == "triple" and t20.number == 20 and t20.value == 60, t20
    bull = polar_to_segment(0.02, 10)
    assert bull.kind == "bull", bull
    d16 = polar_to_segment(0.97, angle_for_number(16))
    assert d16.kind == "double" and d16.number == 16, d16
    miss = polar_to_segment(1.2, 0)
    assert miss.kind == "miss", miss
    console.print(f"[green]geometry OK[/green] board order={list(BOARD_ORDER)[:5]}…")
    console.print(f"  sample T20 → {t20}")
    console.print(f"  sample D16 → {d16}")
    console.print(f"  sample BULL → {bull}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="no3_detect",
        description="No3 Darts DIY camera detection (not Autodarts)",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_cal = sub.add_parser("calibrate", help="Interactive board calibration (mouse/keys)")
    p_cal.add_argument("--camera", default="0", help="Device index or stream URL")
    p_cal.add_argument("--id", default="cam0", help="Camera id")
    p_cal.add_argument("--out", default="./calib/cam0.json", help="Output JSON path")
    p_cal.set_defaults(func=cmd_calibrate)

    p_vis = sub.add_parser(
        "calibrate-vision",
        help="Calibrate with Grok vision (XAI_API_KEY) or OpenCV auto",
    )
    p_vis.add_argument("--camera", default="0", help="Single camera source")
    p_vis.add_argument(
        "--cameras",
        nargs="+",
        default=None,
        help="Multiple sources e.g. --cameras 0 1 2",
    )
    p_vis.add_argument("--id", default="cam0", help="Camera id (single)")
    p_vis.add_argument("--ids", nargs="+", default=None, help="Ids matching --cameras")
    p_vis.add_argument("--out", default="./calib/cam0.json", help="Output for single cam")
    p_vis.add_argument("--outdir", default="./calib", help="Output dir for multi-cam")
    p_vis.add_argument(
        "--method",
        choices=["vision", "auto", "vision-or-auto"],
        default="vision-or-auto",
        help="vision=Grok only, auto=OpenCV only, vision-or-auto=try Grok then OpenCV",
    )
    p_vis.add_argument("--api-key", default="", help="xAI API key (or env XAI_API_KEY)")
    p_vis.add_argument(
        "--model",
        default=None,
        help="Vision model (default grok-build-0.1 or XAI_VISION_MODEL)",
    )
    p_vis.add_argument("-y", "--yes", action="store_true", help="Skip preview confirm")
    p_vis.add_argument(
        "--continue-on-error",
        action="store_true",
        help="Keep going if one camera fails",
    )
    p_vis.set_defaults(func=cmd_calibrate_vision)

    p_run = sub.add_parser("run", help="Run live detection loop (legacy v1)")
    p_run.add_argument("--config", default="config.yaml")
    p_run.add_argument("--dry-run", action="store_true")
    p_run.add_argument("--no-preview", action="store_true")
    p_run.set_defaults(func=cmd_run)

    p_v2c = sub.add_parser(
        "v2-calibrate",
        help="v2: manual 4-click calib (optional; prefer v2-auto-calibrate)",
    )
    p_v2c.add_argument("--camera", default="0")
    p_v2c.add_argument("--id", default="cam0")
    p_v2c.add_argument("--out", default="./calib/cam0.json")
    p_v2c.set_defaults(func=cmd_v2_calibrate)

    p_v2a = sub.add_parser(
        "v2-auto-calibrate",
        help="v2: FULLY AUTO calib — no mouse clicks (Grok optional + OpenCV)",
    )
    p_v2a.add_argument("--camera", default="0", help="Single camera")
    p_v2a.add_argument("--cameras", nargs="+", default=None, help="e.g. 0 1 2")
    p_v2a.add_argument("--id", default="cam0")
    p_v2a.add_argument("--ids", nargs="+", default=None)
    p_v2a.add_argument("--out", default="./calib/cam0.json")
    p_v2a.add_argument("--outdir", default="./calib")
    p_v2a.add_argument("--api-key", default="", help="xAI key or env XAI_API_KEY")
    p_v2a.add_argument("--model", default=None, help="default grok-build-0.1")
    p_v2a.add_argument(
        "--opencv-only",
        action="store_true",
        help="Skip Grok; OpenCV ellipse only",
    )
    p_v2a.add_argument(
        "-y",
        "--yes",
        action="store_true",
        help="Auto-save without y/n prompt",
    )
    p_v2a.add_argument("--continue-on-error", action="store_true")
    p_v2a.set_defaults(func=cmd_v2_auto_calibrate)

    p_v2r = sub.add_parser("v2-run", help="v2: board-plane multi-cam detection (recommended)")
    p_v2r.add_argument("--config", default="config.yaml")
    p_v2r.add_argument("--dry-run", action="store_true")
    p_v2r.add_argument("--no-preview", action="store_true")
    p_v2r.set_defaults(func=cmd_v2_run)

    p_sim = sub.add_parser("simulate", help="Post fake darts to No3 API")
    p_sim.add_argument("--url", default="http://localhost:3000")
    p_sim.add_argument("--api-key", default="")
    p_sim.add_argument("--room", default="Board 1")
    p_sim.add_argument("--count", type=int, default=6)
    p_sim.add_argument("--delay", type=float, default=1.2)
    p_sim.add_argument("--dry-run", action="store_true")
    p_sim.add_argument("--180", dest="one_eighty", action="store_true", help="Post T20 T20 T20")
    p_sim.set_defaults(func=cmd_simulate)

    p_geo = sub.add_parser("test-geometry", help="Unit-check segment mapping")
    p_geo.set_defaults(func=cmd_test_geometry)

    p_list = sub.add_parser("list-cameras", help="List working camera indices (Windows/USB)")
    p_list.set_defaults(func=cmd_list_cameras)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
