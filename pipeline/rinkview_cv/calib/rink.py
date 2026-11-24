"""Derive the rink geometry and stable landmark IDs from a template."""

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

Point = tuple[float, float]


@dataclass(frozen=True)
class RinkTemplate:
    id: str
    length_m: float
    width_m: float
    corner_radius_m: float
    goal_line_from_end_m: float
    blue_line_from_centre_m: float
    faceoff_circle_radius_m: float
    end_faceoff: dict[str, float]
    neutral_faceoff: dict[str, float]
    goal_width_m: float = 1.8288
    trapezoid: dict[str, float] | None = None

    @property
    def goal_x(self) -> float:
        return self.length_m / 2 - self.goal_line_from_end_m

    def board_y(self, x: float) -> float:
        radius = self.corner_radius_m
        offset = max(0.0, abs(x) - (self.length_m / 2 - radius))
        return self.width_m / 2 - radius + math.sqrt(max(0, radius**2 - offset**2))

    def landmarks(self) -> dict[str, Point]:
        landmarks = {
            "centre_dot": (0, 0),
            "centre_line_near": (0, -self.width_m / 2),
            "centre_line_far": (0, self.width_m / 2),
        }
        for end, sx in (("left", -1), ("right", 1)):
            for side, sy in (("near", -1), ("far", 1)):
                def add(mark: str, x: float, y: float) -> None:
                    landmarks[f"{end}_{mark}_{side}"] = (sx * x, sy * y)

                add("blue_line", self.blue_line_from_centre_m, self.board_y(self.blue_line_from_centre_m))
                add("goal_line", self.goal_x, self.board_y(self.goal_x))
                add("goal_post", self.goal_x, self.goal_width_m / 2)
                add("end_dot", self.goal_x - self.end_faceoff["from_goal_line_m"], self.end_faceoff["from_centre_y_m"])
                add("neutral_dot", self.blue_line_from_centre_m - self.neutral_faceoff["from_blue_line_m"], self.neutral_faceoff["from_centre_y_m"])
                if self.trapezoid:
                    add("trapezoid_goal", self.goal_x, self.trapezoid["goal_line_half_width_m"])
                    add("trapezoid_boards", self.length_m / 2, self.trapezoid["end_boards_half_width_m"])
        return landmarks

    def outline(self) -> NDArray[np.float64]:
        r = self.corner_radius_m
        px, py = self.length_m / 2 - r, self.width_m / 2 - r
        return np.concatenate([
            _arc((sx * px, sy * py), r, start, start + 90, 33)
            for sx, sy, start in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270))
        ])

    def markings(self) -> list[tuple[str, NDArray[np.float64]]]:
        landmarks = self.landmarks()
        lines = []
        for line, colour in (
            ("centre_line", "red"),
            ("left_blue_line", "blue"),
            ("right_blue_line", "blue"),
            ("left_goal_line", "red"),
            ("right_goal_line", "red"),
        ):
            lines.append((colour, np.array([landmarks[f"{line}_near"], landmarks[f"{line}_far"]])))
        for name, point in landmarks.items():
            if name == "centre_dot" or "_end_dot_" in name:
                lines.append(("blue" if name == "centre_dot" else "red", _arc(point, self.faceoff_circle_radius_m, 0, 360, 97)))
            if "_trapezoid_goal_" in name:
                lines.append(("red", np.array([point, landmarks[name.replace("_goal_", "_boards_")]])))
        return lines


def load_rink_template(path: str | Path) -> RinkTemplate:
    with Path(path).open(encoding="utf-8") as handle:
        rink = RinkTemplate(**json.load(handle))
    r = rink.corner_radius_m
    if not 0 < r <= min(rink.length_m, rink.width_m) / 2:
        raise ValueError("invalid rink dimensions or corner radius")
    if not 0 < rink.blue_line_from_centre_m < rink.goal_x < rink.length_m / 2:
        raise ValueError("expected centre, blue, then goal line in each rink half")
    return rink


def _arc(centre: Point, radius: float, start: float, end: float, samples: int) -> NDArray[np.float64]:
    angles = np.deg2rad(np.linspace(start, end, samples))
    return np.column_stack((np.cos(angles), np.sin(angles))) * radius + centre
