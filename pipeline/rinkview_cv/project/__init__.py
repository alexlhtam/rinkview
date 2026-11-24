"""Project points between full-frame pixels and centre-origin rink metres."""

from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike, NDArray


@dataclass(frozen=True)
class RadialCorrection:
    """One-coefficient pixel undistortion, normalized by a pixel scale."""

    centre_px: tuple[float, float]
    scale_px: float
    k: float

    def __post_init__(self) -> None:
        if np.asarray(self.centre_px).shape != (2,) or not np.isfinite(self.centre_px).all():
            raise ValueError("radial correction requires a finite pixel centre")
        if not np.isfinite(self.scale_px) or self.scale_px <= 0 or not np.isfinite(self.k) or self.k < 0:
            raise ValueError("radial correction requires a positive scale and nonnegative coefficient")

    def undistort(self, points: ArrayLike) -> NDArray[np.float64]:
        delta = (np.asarray(points, dtype=np.float64) - self.centre_px) / self.scale_px
        radius_squared = np.sum(delta**2, axis=-1, keepdims=True)
        return self.centre_px + self.scale_px * delta * (1 + self.k * radius_squared)

    def distort(self, points: ArrayLike) -> NDArray[np.float64]:
        delta = (np.asarray(points, dtype=np.float64) - self.centre_px) / self.scale_px
        corrected = np.linalg.norm(delta, axis=-1, keepdims=True)
        if self.k == 0:
            return self.centre_px + self.scale_px * delta
        # Invert r + k*r^3 = corrected radius.
        factor = np.sqrt(3 * self.k)
        radius = 2 * np.sinh(np.arcsinh(1.5 * factor * corrected) / 3) / factor
        ratio = np.divide(radius, corrected, out=np.ones_like(radius), where=corrected != 0)
        return self.centre_px + self.scale_px * delta * ratio


def image_to_rink(points: ArrayLike, homography: ArrayLike) -> NDArray[np.float64]:
    return _transform(points, _matrix(homography))


def rink_to_image(points: ArrayLike, homography: ArrayLike) -> NDArray[np.float64]:
    return _transform(points, np.linalg.inv(_matrix(homography)))


def _matrix(homography: ArrayLike) -> NDArray[np.float64]:
    matrix = np.asarray(homography, dtype=np.float64)
    if matrix.shape != (3, 3) or not np.isfinite(matrix).all():
        raise ValueError("homography must be a finite 3×3 matrix")
    if np.linalg.matrix_rank(matrix) != 3:
        raise ValueError("homography must be invertible")
    return matrix


def _transform(points: ArrayLike, matrix: NDArray[np.float64]) -> NDArray[np.float64]:
    points = np.asarray(points, dtype=np.float64)
    if points.ndim == 0 or points.shape[-1] != 2 or not np.isfinite(points).all():
        raise ValueError("points must be finite with shape (..., 2)")
    numerators = points @ matrix[:2, :2].T + matrix[:2, 2]
    denominator = points @ matrix[2, :2] + matrix[2, 2]
    if np.any(denominator == 0):
        raise ValueError("point projects to infinity")
    return numerators / denominator[..., None]
