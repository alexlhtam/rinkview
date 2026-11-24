"""Analyze one locally supplied screenshot without tracking or temporal votes."""

import cv2
import numpy as np

from rinkview_cv.detect import Detector
from rinkview_cv.project.ice import Calibration, IceFilter, box_foot
from rinkview_cv.teams import classify_image, jersey_features


def analyze_image(raw: bytes, detector: Detector, calibration: Calibration | None = None):
    if not raw:
        raise ValueError("could not decode screenshot")
    image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("could not decode screenshot")
    height, width = image.shape[:2]
    if calibration and calibration.image_size != (width, height):
        raise ValueError("image size does not match calibration (expected width, height)")
    crop = calibration.crop() if calibration else (0, 0, width, height)
    if crop[2] <= crop[0] or crop[3] <= crop[1]:
        raise ValueError("calibration is outside this screenshot")
    detections = [d for d in detector.detect(image, crop) if d.xyxy[2] > d.xyxy[0] and d.xyxy[3] > d.xyxy[1]]
    if calibration:
        accepted = [d for d in IceFilter(calibration).apply(detections) if d.on_ice]
        points = [(d.foot, d.point) for d in accepted]
        detections = [d.detection for d in accepted]
    else:
        points = [(box_foot(d), None) for d in detections]
    assignments = classify_image(detections, [jersey_features(image, d.xyxy) for d in detections])
    return {"image_size": [width, height], "detections": [
        {"bbox": detection.xyxy, "foot_px": foot, "confidence": detection.conf,
         "role": label.role, "team": label.team,
         **({"x_m": rink[0], "y_m": rink[1]} if rink is not None else {})}
        for detection, (foot, rink), label in zip(detections, points, assignments)
    ]}
