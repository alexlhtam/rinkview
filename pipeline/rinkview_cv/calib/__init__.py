"""Fit the mapping from undistorted full-frame pixels to rink metres."""

from dataclasses import dataclass

import cv2
import numpy as np
from numpy.typing import ArrayLike, NDArray

from rinkview_cv.project import image_to_rink

from .rink import RinkTemplate, load_rink_template

__all__ = ["HomographyFit", "RinkTemplate", "load_rink_template", "solve_homography"]


@dataclass(frozen=True)
class HomographyFit:
    homography: NDArray[np.float64]
    errors_m: NDArray[np.float64]
    inliers: NDArray[np.bool_]
    rms_m: float


def solve_homography(
    image_points: ArrayLike, rink_points: ArrayLike, *, ransac_threshold_m: float = 0.5
) -> HomographyFit:
    """Return RANSAC inliers and forward metre error, including RMS over all input pairs."""
    image = np.asarray(image_points, dtype=np.float64)
    rink = np.asarray(rink_points, dtype=np.float64)
    if image.ndim != 2 or image.shape[1] != 2 or rink.shape != image.shape or len(image) < 4:
        raise ValueError("at least four matching (x, y) pairs are required")
    if not np.isfinite(image).all() or not np.isfinite(rink).all():
        raise ValueError("landmark coordinates must be finite")
    if not np.isfinite(ransac_threshold_m) or ransac_threshold_m <= 0:
        raise ValueError("RANSAC threshold must be positive and finite")
    matrix, mask = cv2.findHomography(image, rink, cv2.RANSAC, ransac_threshold_m)
    if matrix is None or mask is None or np.count_nonzero(mask) < 4:
        raise ValueError("could not fit a homography; spread the landmarks across the ice")
    errors = np.linalg.norm(image_to_rink(image, matrix) - rink, axis=1)
    return HomographyFit(matrix, errors, mask.ravel().astype(bool), float(np.sqrt(np.mean(errors**2))))
