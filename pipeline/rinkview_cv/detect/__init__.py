"""Frame-level detector contract; boxes use full-frame pixels."""

from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

import numpy as np

Role = Literal["player", "goalie", "referee"]
Box = tuple[float, float, float, float]


@dataclass(frozen=True)
class Detection:
    xyxy: Box
    conf: float
    role: Role | Literal["person"] = "person"


class Detector(Protocol):
    def detect(self, image: np.ndarray, crop: tuple[int, int, int, int]) -> list[Detection]: ...


def horizontal_tiles(crop, tile_width=1536, overlap=256):
    x1, y1, x2, y2 = crop
    width = x2 - x1
    count = max(1, int(np.ceil((width - overlap) / (tile_width - overlap))))
    for left in np.rint(np.linspace(x1, max(x1, x2 - tile_width), count)).astype(int):
        yield int(left), y1, min(x2, int(left) + tile_width), y2


def _iou(a: Box, b: Box) -> float:
    intersection = (
        max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
        * max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    )
    if not intersection:
        return 0.0
    return intersection / (
        (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection
    )


class YoloDetector:
    def __init__(self, device: str, weights: str | Path):
        import torch
        from ultralytics import YOLO

        if device == "cuda" and not torch.cuda.is_available():
            raise ValueError("CUDA was requested but PyTorch cannot see a CUDA device")
        if device == "cpu":
            torch.set_num_threads(min(torch.get_num_threads(), 4))
        self.device = "0" if device == "cuda" else device
        self.model = YOLO(str(weights))
        self.roles = {
            index: name
            for index, name in self.model.names.items()
            if name in {"person", "player", "goalie", "referee"}
        }
        if not self.roles:
            raise ValueError("the detector has no person, player, goalie or referee class")

    def detect(self, image, crop):
        tiles = list(horizontal_tiles(crop))
        results = self.model.predict(
            [image[y1:y2, x1:x2] for x1, y1, x2, y2 in tiles],
            imgsz=1280, conf=0.12, classes=list(self.roles), device=self.device, verbose=False,
        )
        candidates = []
        for tile, ((left, top, _, _), result) in enumerate(zip(tiles, results)):
            for x1, y1, x2, y2, conf, cls in result.boxes.data.cpu().numpy():
                box = (float(x1 + left), float(y1 + top), float(x2 + left), float(y2 + top))
                role = self.roles[int(cls)]
                if conf > .10:
                    candidates.append((tile, Detection(box, float(conf), role)))
        kept = []
        for tile, candidate in sorted(candidates, key=lambda entry: -entry[1].conf):
            if not any(
                (tile != other_tile or candidate.role == other.role) and _iou(candidate.xyxy, other.xyxy) > .45
                for other_tile, other in kept
            ):
                kept.append((tile, candidate))
        return [detection for _, detection in kept]
