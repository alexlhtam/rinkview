"""Mask detections in calibrated image space, then project accepted feet."""

import json
from collections import deque
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from rinkview_cv.calib import RinkTemplate, load_rink_template
from rinkview_cv.detect import Detection
from rinkview_cv.project import RadialCorrection, image_to_rink, rink_to_image


@dataclass(frozen=True)
class Calibration:
    rink: RinkTemplate
    image_size: tuple[int, int]
    homography: np.ndarray
    polygon: np.ndarray
    correction: RadialCorrection | None
    period: int
    side_view: bool
    off_ice_zones: tuple[np.ndarray, ...]

    @classmethod
    def load(cls, path: Path):
        config = json.loads(path.read_text(encoding="utf-8"))
        rink = load_rink_template(path.parent / config["rink_template"])
        return cls.from_config(config, rink)

    @classmethod
    def from_config(cls, config: dict, rink: RinkTemplate):
        correction = RadialCorrection(**config["radial_correction"]) if "radial_correction" in config else None
        homography = np.asarray(config["homography"], dtype=float)
        outline = rink_to_image(rink.outline(), homography)
        if correction:
            outline = correction.distort(outline)
        polygon = np.array(config.get("ice_mask_polygon", outline), dtype=np.float32)
        if polygon.ndim != 2 or polygon.shape[1] != 2 or len(polygon) < 3 or not np.isfinite(polygon).all():
            raise ValueError("ice mask must have at least three finite (x, y) vertices")
        return cls(
            rink, tuple(config["image_size"]), homography, polygon, correction,
            int(config.get("source", {}).get("period", 1)), config.get("position_kind") == "side",
            tuple(np.asarray(zone, dtype=np.float32) for zone in config.get("off_ice_zones", [])),
        )

    def crop(self):
        width, height = self.image_size
        x, y, w, h = cv2.boundingRect(self.polygon)
        return (
            max(0, x - round(width * .02)), max(0, y - round(height * .11)),
            min(width, x + w + round(width * .02)), min(height, y + h + round(height * .06)),
        )

    def project(self, foot):
        points = self.correction.undistort(foot) if self.correction else foot
        return image_to_rink(points, self.homography)


def clamp_to_rink(points, rink):
    points = np.asarray(points, dtype=float)
    radius = rink.corner_radius_m
    inner = np.array([rink.length_m / 2, rink.width_m / 2]) - radius
    anchor = np.clip(points, -inner, inner)
    delta = points - anchor
    norm = np.linalg.norm(delta, axis=-1, keepdims=True)
    return anchor + delta * (radius / np.maximum(radius, norm))


def near_edge_y(polygon, x):
    intersections = []
    for a, b in zip(polygon, np.roll(polygon, -1, axis=0)):
        if min(a[0], b[0]) <= x <= max(a[0], b[0]):
            if a[0] == b[0]:
                intersections.append(max(a[1], b[1]))
            else:
                intersections.append(a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))
    return float(max(intersections)) if intersections else None


@dataclass(frozen=True)
class IceDetection:
    detection: Detection
    foot: tuple[float, float]
    point: tuple[float, float]
    on_ice: bool
    estimated: bool


def box_foot(detection: Detection):
    x1, y1, x2, y2 = detection.xyxy
    return ((x1 + x2) / 2, y2 - .03 * (y2 - y1))


class IceFilter:
    def __init__(self, calibration: Calibration):
        self.calib = calibration
        self.heights = deque(maxlen=1024)
        self.scale = calibration.image_size[1] / 2160
        # Intersect the mask once per sample x, not once per detection.
        board_x = np.linspace(0, calibration.image_size[0] - 1, 257) if calibration.side_view else []
        pairs = [(x, near_edge_y(calibration.polygon, x)) for x in board_x]
        pairs = [(x, y) for x, y in pairs if y is not None]
        self.board_x, self.board_y = zip(*pairs) if pairs else ((), ())

    def _inside(self, foot):
        return cv2.pointPolygonTest(self.calib.polygon, foot, False) >= 0

    def _height(self, x, y):
        if len(self.heights) < 8:
            return None
        samples = np.asarray(self.heights)
        distance = ((samples[:, 0] - x) / 5) ** 2 + (samples[:, 1] - y) ** 2
        order = np.argsort(distance)[:24]
        return float(np.percentile(samples[order, 2], 65))

    def apply(self, detections: list[Detection]) -> list[IceDetection]:
        candidates = []
        for detection in detections:
            x1, y1, x2, y2 = detection.xyxy
            height = y2 - y1
            if height <= 0 or x2 <= x1:
                continue
            foot = box_foot(detection)
            x = foot[0]
            board = float(np.interp(x, self.board_x, self.board_y)) if self.board_x else None
            if (board is not None and board - y2 >= 32 * self.scale
                    and detection.role in {"person", "player"} and detection.conf >= .4 and self._inside(foot)):
                self.heights.append((*foot, height))
            candidates.append((detection, foot, y1, y2, height, board))

        accepted = []
        for detection, foot, top, bottom, height, board in candidates:
            estimated = False
            if board is not None and -6 * self.scale <= board - bottom <= 32 * self.scale:
                typical = self._height(foot[0], board)
                if typical is not None and .45 * typical <= height < .9 * typical:
                    estimate = (foot[0], top + .97 * typical)
                    if self._inside(estimate):
                        foot, estimated = estimate, True
            if not self._inside(foot):
                continue
            projected = self.calib.project(foot)
            on_ice = not any(
                cv2.pointPolygonTest(zone, tuple(projected), False) >= 0
                for zone in self.calib.off_ice_zones
            )
            clamped = clamp_to_rink(projected, self.calib.rink) if on_ice else projected
            if not on_ice or np.linalg.norm(clamped - projected) <= 2.0:
                accepted.append(IceDetection(detection, foot, tuple(clamped), on_ice, estimated))
        return accepted
