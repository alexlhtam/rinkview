"""Check for camera shifts relative to the first frame of a clip."""

import cv2
import numpy as np


class DriftMonitor:
    def __init__(self, polygon):
        self.polygon = polygon
        self.orb = cv2.ORB_create(nfeatures=1200)
        self.matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        self.reference = None
        self.mask = None
        self.next_check = 0.0
        self.warnings = []

    def observe(self, t, image):
        if t < self.next_check:
            return
        self.next_check = t + 5
        scale = min(1.0, 960 / image.shape[1])
        gray = cv2.cvtColor(cv2.resize(image, None, fx=scale, fy=scale), cv2.COLOR_BGR2GRAY)
        if self.mask is None:
            shape = np.zeros_like(gray)
            cv2.fillPoly(shape, [np.rint(self.polygon * scale).astype(np.int32)], 255)
            outer = cv2.dilate(shape, np.ones((81, 81), dtype=np.uint8))
            inner = cv2.dilate(shape, np.ones((13, 13), dtype=np.uint8))
            self.mask = cv2.subtract(outer, inner)
        keypoints, descriptors = self.orb.detectAndCompute(gray, self.mask)
        if descriptors is None:
            return
        if self.reference is None:
            self.reference = keypoints, descriptors
            return
        original_keypoints, original_descriptors = self.reference
        matches = sorted(self.matcher.match(original_descriptors, descriptors), key=lambda match: match.distance)
        matches = [match for match in matches[:150] if match.distance < 45]
        if len(matches) < 30:
            return
        shifts = np.asarray([
            np.subtract(keypoints[match.trainIdx].pt, original_keypoints[match.queryIdx].pt)
            for match in matches
        ])
        shift = float(np.linalg.norm(np.median(shifts, axis=0)))
        if shift > 3:
            self.warnings.append({
                "start_s": max(0.0, t - 5), "end_s": t,
                "message": f"Possible camera shift (~{shift / scale:.0f} px); check calibration.",
            })
