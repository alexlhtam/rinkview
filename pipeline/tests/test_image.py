import json
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

from rinkview_cv.cli import main
from rinkview_cv.detect import Detection


class Detector:
    def detect(self, image, crop):
        return [Detection((x, 15, x + 22, 60), .9, role) for x, role in (
            (12, "person"), (42, "person"), (72, "referee"), (102, "goalie"), (135, "person"),
        )]


@pytest.fixture
def screenshot(tmp_path):
    image = np.full((80, 160, 3), 220, np.uint8)
    image[15:60, 12:34] = (240, 240, 240)
    image[15:60, 42:64] = (170, 25, 30)
    path = tmp_path / "test.png"
    assert cv2.imwrite(str(path), image)
    return path


def test_detect_image_cli_outputs_json(screenshot, monkeypatch, capsys):
    monkeypatch.setattr("rinkview_cv.detect.YoloDetector", lambda *_: Detector())
    monkeypatch.setattr(sys, "argv", ["rinkview", "detect-image", str(screenshot)])
    main()
    result = json.loads(capsys.readouterr().out)
    assert result["image_size"] == [160, 80]
    assert [d["team"] for d in result["detections"][:3]] == ["A", "B", "none"]
    assert [d["role"] for d in result["detections"][:4]] == ["player", "player", "referee", "goalie"]
    assert result["detections"][0]["foot_px"] == [23, 58.65]
    assert "x_m" not in result["detections"][0]


def test_analyze_endpoint_filters_and_projects(screenshot):
    pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient
    from rinkview_cv.server import create_app

    rink = Path(__file__).resolve().parents[2] / "shared/rink_templates/ally-pally-estimate.json"
    calibration = {
        "image_size": [160, 80],
        "homography": [[.3, 0, -24], [0, -.3, 12], [0, 0, 1]],
        "ice_mask_polygon": [[2, 10], [128, 10], [128, 76], [2, 76]],
    }
    client = TestClient(create_app(Detector()))
    files = {"image": ("test.png", screenshot.read_bytes(), "image/png")}
    assert client.post("/analyze", files=files).status_code == 200
    data = {"calibration": json.dumps(calibration), "rink": rink.read_text()}
    response = client.post("/analyze", files=files, data=data)
    assert response.status_code == 200, response.text
    points = response.json()["detections"]
    assert len(points) == 4
    assert points[0]["x_m"] == pytest.approx(-17.1)
    assert points[0]["y_m"] == pytest.approx(-5.595)
    assert client.post("/analyze", files={"image": ("broken.png", b"x")}).status_code == 422
