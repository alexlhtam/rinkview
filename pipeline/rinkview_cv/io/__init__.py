"""Decode source frames on a uniform sampling clock, using video PTS."""

from dataclasses import dataclass
from itertools import chain
from pathlib import Path

import av
import numpy as np


def sample_clock(frames, fps):
    """Yield each due frame once, including after a source timestamp gap."""
    tick = 0
    for index, timestamp, frame in frames:
        if timestamp + 1e-9 >= tick / fps:
            yield index, timestamp, frame
            tick = int(np.floor((timestamp + 1e-9) * fps)) + 1


@dataclass(frozen=True)
class Frame:
    index: int
    t: float
    image: np.ndarray


class Video:
    def __init__(self, path: Path, fps: float, size: tuple[int, int]):
        self.path = path
        self.fps = fps
        self.size = size
        self.times = []
        self.sample_fps = fps

    def _decode(self):
        self.times = []
        with av.open(str(self.path)) as container:
            if not container.streams.video:
                raise ValueError(f"no video stream: {self.path}")
            stream = container.streams.video[0]
            stream.thread_type = "AUTO"
            stream.codec_context.thread_count = 4
            if (stream.width, stream.height) != self.size:
                raise ValueError("video size does not match calibration (expected width, height)")
            rate = float(stream.average_rate or self.fps)
            self.sample_fps = min(self.fps, rate)
            first = None
            for index, decoded in enumerate(container.decode(stream)):
                stamp = decoded.time
                if stamp is not None and first is None:
                    first = stamp - index / rate
                timestamp = stamp - first if stamp is not None else index / rate
                if self.times:
                    timestamp = max(timestamp, self.times[-1])
                self.times.append(timestamp)
                yield index, timestamp, decoded

    def __iter__(self):
        frames = self._decode()
        try:
            first = next(frames, None)
            if first is None:
                raise ValueError(f"no decodable video frames: {self.path}")
            for index, timestamp, decoded in sample_clock(chain([first], frames), self.sample_fps):
                yield Frame(index, timestamp, decoded.to_ndarray(format="bgr24"))
        finally:
            frames.close()
