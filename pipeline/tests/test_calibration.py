import json
from pathlib import Path
import subprocess
import sys

import cv2
import jsonschema
import numpy as np
import pytest

from rinkview_cv.calib import load_rink_template, solve_homography
from rinkview_cv.project import RadialCorrection, image_to_rink, rink_to_image

SHARED = Path(__file__).resolve().parents[2] / "shared"


@pytest.mark.parametrize("preset", ["nhl", "iihf", "custom-uk-56x26"])
def test_rink_geometry(preset):
    rink = load_rink_template(SHARED / "rink_templates" / f"{preset}.json")
    landmarks = rink.landmarks()
    assert landmarks["centre_dot"] == (0, 0)
    assert landmarks["left_blue_line_near"] == (-rink.blue_line_from_centre_m, -rink.width_m / 2)
    assert landmarks["right_end_dot_far"] == (
        rink.goal_x - rink.end_faceoff["from_goal_line_m"],
        rink.end_faceoff["from_centre_y_m"],
    )
    assert landmarks["right_goal_post_far"] == (rink.goal_x, rink.goal_width_m / 2)
    assert landmarks["left_goal_line_far"][1] < rink.width_m / 2
    assert ("right_trapezoid_boards_far" in landmarks) == (preset != "custom-uk-56x26")
    np.testing.assert_allclose(np.max(np.abs(rink.outline()), axis=0), [rink.length_m / 2, rink.width_m / 2])


def test_ransac_projection_and_error_include_outlier():
    h = np.array([[0.02, 0.004, -18], [0.005, -0.04, 28], [0.0001, 0.0002, 1]])
    pixels = np.array([[0, 0], [1200, 0], [1200, 900], [0, 900], [150, 150], [750, 700], [300, 500]])
    metres = image_to_rink(pixels, h)
    metres[-1] += (5, 0)
    fit = solve_homography(pixels, metres)
    np.testing.assert_array_equal(fit.inliers, [True] * 6 + [False])
    np.testing.assert_allclose(fit.errors_m, [0] * 6 + [5], atol=1e-5)
    assert fit.rms_m == pytest.approx(5 / np.sqrt(7))
    np.testing.assert_allclose(rink_to_image(metres[:-1], fit.homography), pixels[:-1], atol=1e-4)


def test_rejects_degenerate_fit():
    points = [[x, 0] for x in range(4)]
    with pytest.raises(ValueError, match="spread the landmarks"):
        solve_homography(points, points)


def test_radial_correction_round_trip():
    correction = RadialCorrection(centre_px=(1920, 1080), scale_px=1920, k=0.21)
    pixels = np.array([[0, 0], [1920, 1080], [3839, 2159], [2500, 1700]])
    corrected = correction.undistort(pixels)
    assert not np.allclose(corrected, pixels)
    np.testing.assert_allclose(correction.distort(corrected), pixels, atol=1e-10)


@pytest.mark.parametrize("period", [1, 2, 3])
def test_sample_calibration_reprojection(period):
    path = SHARED / "calibrations" / f"ally-pally-side-p{period}.json"
    calibration = json.loads(path.read_text(encoding="utf-8"))
    rink = load_rink_template(path.parent / calibration["rink_template"])
    pairs = calibration["point_pairs"]
    landmarks = rink.landmarks()
    metres = np.array([landmarks[pair["landmark_id"]] for pair in pairs])
    np.testing.assert_allclose(metres, [pair["rink_m"] for pair in pairs])
    pixels = RadialCorrection(**calibration["radial_correction"]).undistort([pair["image_px"] for pair in pairs])
    error = np.linalg.norm(image_to_rink(pixels, calibration["homography"]) - metres, axis=1)
    np.testing.assert_allclose(error, [pair["error_m"] for pair in pairs])
    assert calibration["reprojection_rms_m"] == pytest.approx(np.sqrt(np.mean(error**2)))
    assert calibration["reprojection_rms_m"] < 0.5
    polygon = np.array(calibration["ice_mask_polygon"])
    assert len(polygon) >= 3
    assert ((polygon >= 0) & (polygon < calibration["image_size"])).all()


def test_calib_overlay_renders_projected_centre_line(tmp_path):
    image = np.zeros((300, 600, 3), dtype=np.uint8)
    frame, out, calib = (tmp_path / name for name in ("frame.png", "out.png", "calib.json"))
    assert cv2.imwrite(str(frame), image)
    calib.write_text(json.dumps({
        "image_size": [600, 300],
        "rink_template": str(SHARED / "rink_templates" / "iihf.json"),
        "homography": [[0.12, 0, -36], [0, -0.12, 18], [0, 0, 1]],
    }), encoding="utf-8")
    subprocess.run([
        sys.executable, "-m", "rinkview_cv.cli", "calib-overlay",
        "--frame", str(frame), "--calib", str(calib), "--out", str(out),
    ], check=True)
    overlay = cv2.imread(str(out))
    np.testing.assert_array_equal(overlay.shape, image.shape)
    assert overlay[125, 300, 2] > 100
    assert not overlay[125, 310].any()


@pytest.mark.parametrize("name", ["positions", "summary"])
def test_schema_example(name):
    schema = json.loads((SHARED / "schemas" / f"{name}.schema.json").read_text(encoding="utf-8"))
    example = json.loads((SHARED / "schemas" / f"{name}.example.json").read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator.check_schema(schema)
    jsonschema.validate(example, schema)
