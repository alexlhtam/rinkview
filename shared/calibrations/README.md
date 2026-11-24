# Sample calibrations

The three Alexandra Palace side views require individual calibrations because
the framing differs by period. The `source` object records the sample and
reference-frame offset used to select landmarks. These are coaching estimates
against a custom 56 × 26 m template, not surveyed rink dimensions. Close-range
boards hide some paint and physical ice edges; the visible-ice polygon follows
the on-screen boundary rather than pretending that the rink outline is visible.

- `image_size` is `[width, height]`; calibration coordinates refer to the
  uncropped source at that resolution.
- `point_pairs[].image_px` and `ice_mask_polygon` use raw frame pixels
  (x right, y down). The `rink_m` pairs are derived from template landmarks.
- `homography` maps **undistorted pixels to rink metres**. If
  `radial_correction` is present, first use `RadialCorrection.undistort` on
  the raw pixels. If absent, use raw pixels directly. For the reverse mapping,
  call `rink_to_image` followed by `RadialCorrection.distort` when applicable.
- `reprojection_rms_m` includes all selected point pairs, not just RANSAC
  inliers. It measures alignment at clicked landmarks only; it is not a player
  position-accuracy estimate.
