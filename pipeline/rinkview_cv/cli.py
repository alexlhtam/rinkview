"""Command-line rink calibration preview."""

import argparse
import json
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
    args = parser.parse_args()
    try:
        _overlay(args.frame, args.calib, args.out)
    except (OSError, KeyError, ValueError, TypeError, cv2.error) as exc:
        parser.exit(2, f"rinkview: {exc}\n")


if __name__ == "__main__":
    main()
