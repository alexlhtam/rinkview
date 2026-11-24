"""Frame-level detector contract; boxes use full-frame pixels."""

from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

import cv2
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
        found = []
        for (left, top, _, _), result in zip(tiles, results):
            for x1, y1, x2, y2, conf, cls in result.boxes.data.cpu().numpy():
                box = (float(x1 + left), float(y1 + top), float(x2 + left), float(y2 + top))
                found.append(Detection(box, float(conf), self.roles[int(cls)]))
        if not found:
            return []
        boxes = [(x1, y1, x2 - x1, y2 - y1) for x1, y1, x2, y2 in (item.xyxy for item in found)]
        indices = cv2.dnn.NMSBoxes(boxes, [item.conf for item in found], 0.10, 0.45)
        return [found[int(index)] for index in indices]
