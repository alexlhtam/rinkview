"""Local-only HTTP wrapper for screenshot analysis."""

import json
from threading import Lock

import cv2
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from rinkview_cv.calib.rink import parse_rink_template
from rinkview_cv.detect import Detector
from rinkview_cv.image import analyze_image
from rinkview_cv.project.ice import Calibration

MAX_IMAGE_BYTES = 32 * 1024 * 1024


def create_app(detector: Detector) -> FastAPI:
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware, allow_origin_regex=r"http://(?:localhost|127\.0\.0\.1):(?:5173|4173)",
        allow_methods=["POST"], allow_headers=["X-RinkView-Client"],
    )
    inference = Lock()

    @app.post("/analyze")
    def analyze(image: UploadFile = File(), calibration: str | None = Form(None), rink: str | None = Form(None),
                x_rinkview_client: str | None = Header(None)):
        if x_rinkview_client != "web":
            raise HTTPException(403, "Screenshot analysis requires the X-RinkView-Client header.")
        raw = image.file.read(MAX_IMAGE_BYTES + 1)
        if len(raw) > MAX_IMAGE_BYTES:
            raise HTTPException(413, "Screenshot exceeds 32 MiB.")
        try:
            config = None
            if calibration is not None:
                if rink is None:
                    raise ValueError("send the rink template with the calibration")
                config = Calibration.from_config(json.loads(calibration), parse_rink_template(json.loads(rink)))
            with inference:
                return analyze_image(raw, detector, config)
        except (KeyError, TypeError, ValueError, AttributeError, OverflowError, cv2.error) as exc:
            raise HTTPException(422, str(exc)) from exc

    return app
