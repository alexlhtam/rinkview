"""Command-line rink calibration preview and video processing."""

import argparse
import json
import math
import sys
from contextlib import redirect_stdout
from pathlib import Path

import cv2
import numpy as np

from rinkview_cv.calib import load_rink_template
from rinkview_cv.project import RadialCorrection, rink_to_image


def _overlay(frame: Path, calib: Path, out: Path) -> None:
    config = json.loads(calib.read_text(encoding="utf-8"))
    rink = load_rink_template(calib.parent / config["rink_template"])
    image = cv2.imread(str(frame), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"could not read frame: {frame}")
    if list(image.shape[1::-1]) != config["image_size"]:
        raise ValueError("frame size does not match calibration (expected width, height)")

    colours = {"outline": (60, 255, 90), "red": (48, 55, 255), "blue": (255, 155, 0)}
    layer = image.copy()
    matrix = config["homography"]

    correction = RadialCorrection(**config["radial_correction"]) if "radial_correction" in config else None

    def project(points):
        pixels = rink_to_image(points, matrix)
        return correction.distort(pixels) if correction else pixels

    def draw(pixels, colour, closed=False):
        pixels = np.clip(pixels, -(2**30), 2**30).astype(np.int32)
        cv2.polylines(layer, [pixels], closed, colours[colour], 3, cv2.LINE_AA)

    ice_polygon = config.get("ice_mask_polygon")
    if ice_polygon is None:
        draw(np.rint(project(rink.outline())), "outline", closed=True)
    for colour, points in rink.markings():
        if correction and len(points) == 2:
            points = np.linspace(points[0], points[1], 65)
        draw(np.rint(project(points)), colour)
    landmarks = list(rink.landmarks().values())
    for x, y in np.rint(project(landmarks)):
        if 0 <= x < image.shape[1] and 0 <= y < image.shape[0]:
            cv2.circle(layer, (int(x), int(y)), 4, (0, 230, 255), -1, cv2.LINE_AA)
    if ice_polygon is not None:
        pixels = np.rint(ice_polygon).astype(np.int32)
        visible = np.zeros(image.shape[:2], dtype=np.uint8)
        cv2.fillPoly(visible, [pixels], 1)
        layer[visible == 0] = image[visible == 0]
        draw(pixels, "outline", closed=True)
    blended = cv2.addWeighted(layer, 0.68, image, 0.32, 0)
    if not cv2.imwrite(str(out), blended):
        raise ValueError(f"could not write overlay: {out}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="rinkview")
    commands = parser.add_subparsers(dest="command", required=True)
    overlay = commands.add_parser("calib-overlay", help="project rink markings onto a calibrated frame")
    for flag in ("frame", "calib", "out"):
        overlay.add_argument(f"--{flag}", type=Path, required=True)
    process = commands.add_parser("process", help="track skaters and export rink positions from a video")
    process.add_argument("video", type=Path)
    process.add_argument("--calib", type=Path, required=True)
    process.add_argument("--out", type=Path, required=True)
    process.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    process.add_argument("--fps", type=float, default=10, help="detection sample rate (default: 10)")
    process.add_argument("--weights", default="yolo11s.pt", help="Ultralytics detection weights (default: yolo11s.pt)")
    process.add_argument("--team-a-jersey", choices=("light", "dark"), default="light",
                         help="choose which jersey cluster is Team A (default: light)")
    process.add_argument("--team-a-defends", choices=("left", "right"), help="override Team A's defending end")
    image = commands.add_parser("detect-image", help="detect and classify players in a screenshot")
    image.add_argument("image", type=Path)
    image.add_argument("--calib", type=Path)
    serve = commands.add_parser("serve", help="serve the local screenshot analysis API")
    serve.add_argument("--port", type=int, default=8000)
    for command in (image, serve):
        command.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
        command.add_argument("--weights", default="yolo11s.pt")
    args = parser.parse_args()
    try:
        if args.command == "calib-overlay":
            _overlay(args.frame, args.calib, args.out)
        elif args.command in ("detect-image", "serve"):
            from rinkview_cv.detect import YoloDetector
            try:
                if args.command == "serve":
                    import uvicorn
                    from rinkview_cv.server import create_app

                    uvicorn.run(create_app(YoloDetector(args.device, args.weights)), host="127.0.0.1", port=args.port)
                else:
                    from rinkview_cv.image import analyze_image
                    from rinkview_cv.project.ice import Calibration

                    config = Calibration.load(args.calib) if args.calib else None
                    with redirect_stdout(sys.stderr):
                        result = analyze_image(args.image.read_bytes(), YoloDetector(args.device, args.weights), config)
                    print(json.dumps(result, allow_nan=False))
            except ModuleNotFoundError as exc:
                raise ValueError("install image analysis dependencies with pip install -e './pipeline[image]'") from exc
        elif args.command == "process":
            if not math.isfinite(args.fps) or args.fps <= 0:
                raise ValueError("--fps must be positive and finite")
            if not args.video.is_file() or not args.calib.is_file():
                raise ValueError("video and calibration must be existing files")
            try:
                from rinkview_cv.detect import YoloDetector
                from rinkview_cv.process import process_video
            except ModuleNotFoundError as exc:
                raise ValueError("install processing dependencies with pip install -e './pipeline[process]'") from exc

            a_defends = {"left": -1, "right": 1}.get(args.team_a_defends)
            print(process_video(
                args.video, args.calib, args.out, YoloDetector(args.device, args.weights), args.fps, a_defends,
                team_a_jersey=args.team_a_jersey,
            ))
    except (OSError, KeyError, ValueError, TypeError, cv2.error) as exc:
        parser.exit(2, f"rinkview: {exc}\n")


if __name__ == "__main__":
    main()
