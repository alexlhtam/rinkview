"""Render tracked boxes and a top-down rink inset to H.264 MP4."""

from collections import defaultdict
from fractions import Fraction

import av
import cv2
import numpy as np

from rinkview_cv.track.positions import HZ

TEAM = {"A": (255, 160, 45), "B": (35, 120, 255), "none": (180, 180, 180)}


def render_debug(video, path, rink, frames, labels, aliases, rows):
    by_tick = defaultdict(list)
    for row in rows:
        by_tick[round(row["t"] * HZ)].append(row)
    width, height = video.size
    scale = min(1600 / width, 900 / height, max(1., 640 / width, 360 / height))
    w, h = int(width * scale) // 2 * 2, int(height * scale) // 2 * 2
    rate = Fraction(video.sample_fps).limit_denominator(10000)
    map_width = min(408, w - 24, max(220, w // 3), int((h - 70) * rink.length_m / rink.width_m))
    canvas, to_pixel = minimap(rink, map_width)
    map_h, map_w = canvas.shape[:2]
    with av.open(str(path), mode="w") as container:
        stream = container.add_stream("libx264", rate=rate)
        stream.width, stream.height, stream.pix_fmt = w, h, "yuv420p"
        stream.options = {"preset": "fast", "crf": "20"}
        stream.codec_context.thread_count = 4
        previous_pts = -1
        for frame in video:
            image = cv2.resize(frame.image, (w, h), interpolation=cv2.INTER_AREA)
            for tracked in frames.get(frame.index, ()):
                ice = tracked.ice
                track_id = aliases[tracked.track_id]
                label = labels[track_id]
                color = TEAM[label.team]
                x1, y1, x2, y2 = (round(v * scale) for v in ice.detection.xyxy)
                cv2.rectangle(image, (x1, y1), (x2, y2), color, 2, cv2.LINE_AA)
                foot = tuple(round(v * scale) for v in ice.foot)
                cv2.circle(image, foot, 4 if ice.estimated else 2, color, 1 if ice.estimated else -1, cv2.LINE_AA)
                suffix = {"goalie": " G", "referee": " R"}.get(label.role, "")
                _text(image, f"{label.team} {track_id}{suffix}", (x1, max(12, y1 - 4)), color, .45)
            inset = canvas.copy()
            for row in by_tick.get(round(frame.t * HZ), ()):
                if row["on_ice"]:
                    pt = to_pixel((row["x_m"], row["y_m"]))
                    radius = 6 if row["role"] == "goalie" else 5
                    cv2.circle(inset, pt, radius + 1, (12, 25, 40), -1, cv2.LINE_AA)
                    cv2.circle(inset, pt, radius, TEAM[row["team"]], -1, cv2.LINE_AA)
            image[12:12 + map_h, w - map_w - 12:w - 12] = inset
            _text(image, f"RINKVIEW  |  {frame.t:05.2f} s", (18, 31), (248, 250, 252), .6)
            encoded = av.VideoFrame.from_ndarray(image, format="bgr24")
            encoded.time_base = 1 / rate
            encoded.pts = max(previous_pts + 1, round(frame.t * float(rate)))
            previous_pts = encoded.pts
            for packet in stream.encode(encoded):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


def _text(image, text, point, color, size):
    cv2.putText(image, text, point, cv2.FONT_HERSHEY_SIMPLEX, size, (15, 25, 35), 3, cv2.LINE_AA)
    cv2.putText(image, text, point, cv2.FONT_HERSHEY_SIMPLEX, size, color, 1, cv2.LINE_AA)


def minimap(rink, width):
    margin = 12
    inner_width = width - 2 * margin
    scale = inner_width / rink.length_m
    ice_height = round(rink.width_m * scale)
    top = 34
    board = np.full((top + ice_height + 24, width, 3), (37, 29, 20), dtype=np.uint8)

    def point(xy):
        x, y = xy
        return round(margin + inner_width / 2 + x * scale), round(top + ice_height / 2 - y * scale)

    outline = np.array([point(xy) for xy in rink.outline()], dtype=np.int32)
    cv2.fillPoly(board, [outline], (244, 241, 231), cv2.LINE_AA)
    colors = {"red": (130, 121, 226), "blue": (216, 146, 122)}
    for name, points in rink.markings():
        pixels = np.array([point(xy) for xy in points], dtype=np.int32)
        cv2.polylines(board, [pixels], False, colors[name], 1, cv2.LINE_AA)
    cv2.polylines(board, [outline], True, (168, 157, 132), 1, cv2.LINE_AA)
    _text(board, "RINK POSITION", (12, 22), (245, 245, 245), .48)
    for label, color in TEAM.items():
        x = 16 + ("AB".index(label) * 70 if label in "AB" else 140)
        y = board.shape[0] - 9
        cv2.circle(board, (x, y - 3), 4, color, -1, cv2.LINE_AA)
        _text(board, f"Team {label}" if label != "none" else "Unassigned", (x + 9, y), (245, 245, 245), .36)
    return board, point
