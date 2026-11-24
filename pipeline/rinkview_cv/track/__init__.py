"""Associate ice detections using a per-video ByteTrack instance."""

from dataclasses import dataclass

import numpy as np
from supervision import ByteTrack, Detections

from rinkview_cv.project.ice import IceDetection


@dataclass(frozen=True)
class Tracked:
    track_id: int
    ice: IceDetection


class Tracker:
    def __init__(self, fps: float):
        self.padding = .28 * np.clip((15 - fps) / 10, 0, 1)
        self.tracker = ByteTrack(
            track_activation_threshold=.17,
            lost_track_buffer=max(1, round(2 * fps)),
            minimum_matching_threshold=.85,
        )

    def update(self, accepted: list[IceDetection]) -> list[Tracked]:
        boxes = np.asarray([item.detection.xyxy for item in accepted], dtype=float).reshape(-1, 4)
        # At sparse sample rates, a skater can move the width of a box between frames.
        padding = self.padding * (boxes[:, 3] - boxes[:, 1])
        boxes += padding[:, None] * np.array([-1, -.5, 1, .5])
        detections = Detections(
            xyxy=boxes,
            confidence=np.asarray([item.detection.conf for item in accepted]),
            data={"source_index": np.arange(len(accepted))},
        )
        matches = self.tracker.update_with_detections(detections)
        if not len(matches):
            return []
        return [
            Tracked(int(track_id), accepted[index])
            for track_id, index in zip(matches.tracker_id, matches.data["source_index"])
        ]
