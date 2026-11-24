"""Per-period player seconds and distinct track counts."""

from math import ceil, floor

import numpy as np

from rinkview_cv.track.positions import HZ


def period_summary(rows, rink, period, a_defends):
    x_min, y_min = -rink.length_m / 2, -rink.width_m / 2
    width, height = ceil(rink.length_m), ceil(rink.width_m)
    grids = {team: np.zeros((height, width), dtype=int) for team in "AB"}
    zones = {team: dict.fromkeys(("defensive_s", "neutral_s", "offensive_s"), 0) for team in "AB"}
    ids = {team: set() for team in ("A", "B", "none")}
    for row in rows:
        team = row["team"]
        ids[team].add(row["track_id"])
        if team == "none" or not row["on_ice"] or row["role"] == "referee":
            continue
        x, y = row["x_m"], row["y_m"]
        toward_own_goal = x * (a_defends if team == "A" else -a_defends)
        blue = rink.blue_line_from_centre_m
        zone = "defensive_s" if toward_own_goal > blue else "offensive_s" if toward_own_goal < -blue else "neutral_s"
        zones[team][zone] += 1
        col = min(width - 1, max(0, floor(x - x_min)))
        row_index = min(height - 1, max(0, floor(y - y_min)))
        grids[team][row_index, col] += 1
    return {
        "period": period,
        "zone_time": {team: {zone: ticks / HZ for zone, ticks in values.items()} for team, values in zones.items()},
        "heatmaps": {
            team: {"x_min_m": x_min, "y_min_m": y_min, "cell_size_m": 1.0, "grid": (grid / HZ).tolist()}
            for team, grid in grids.items()
        },
        "track_counts": {team: len(tracks) for team, tracks in ids.items()},
    }
