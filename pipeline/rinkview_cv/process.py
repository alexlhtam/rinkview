"""Run a video through the standalone RinkView pipeline."""

from collections import Counter, defaultdict
from pathlib import Path
from time import perf_counter

import cv2
import numpy as np

from rinkview_cv.analytics import period_summary
from rinkview_cv.detect import Detector
from rinkview_cv.export import write_json, write_positions
from rinkview_cv.export.debug import render_debug
from rinkview_cv.io import Video
from rinkview_cv.io.drift import DriftMonitor
from rinkview_cv.project.ice import Calibration, IceFilter
from rinkview_cv.teams import classify, jersey_features
from rinkview_cv.track import Tracker
from rinkview_cv.track.positions import Observation, resample, split_team_switches, stitch


def process_video(
    video_path: Path, calib_path: Path, out: Path, detector: Detector, fps: float, a_defends: int | None = None,
    *, team_a_jersey: str = "light",
):
    if not np.isfinite(fps) or fps <= 0:
        raise ValueError("--fps must be positive and finite")
    outputs = {(out / name).resolve() for name in (
        "positions.json", "positions.parquet", "summary.json", "debug.mp4",
    )}
    for name, path in (("input video", video_path), ("calibration", calib_path)):
        if path.resolve() in outputs:
            raise ValueError(f"{name} path would be overwritten by output: {path}")
    start = perf_counter()
    cv2.setNumThreads(4)
    calibration = Calibration.load(calib_path)
    video = Video(video_path, fps, calibration.image_size)
    ice_filter = IceFilter(calibration)
    crop = calibration.crop()
    drift = DriftMonitor(calibration.polygon)
    tracks, frames = defaultdict(list), {}
    stats = Counter()
    tracker = None
    for frame in video:
        if tracker is None:
            tracker = Tracker(video.sample_fps)
        drift.observe(frame.t, frame.image)
        detections = detector.detect(frame.image, crop)
        accepted = ice_filter.apply(detections)
        stats["detections"] += len(detections)
        stats["kept"] += len(accepted)
        stats["estimated"] += sum(item.estimated for item in accepted)
        tracked = tracker.update(accepted)
        stats["tracked"] += len(tracked)
        frames[frame.index] = tracked
        for item in tracked:
            jersey = jersey_features(frame.image, item.ice.detection.xyxy)
            tracks[item.track_id].append(Observation(frame.index, frame.t, item, jersey))

    raw_ids = len(tracks)
    labels, a_defends, switches = classify(
        tracks, calibration.rink, a_defends, team_a_jersey=team_a_jersey, switch_gap=max(.4, 1.5 / video.sample_fps),
    )
    split_team_switches(tracks, frames, labels, switches)
    cleaned, aliases = stitch(tracks, labels, video.sample_fps)
    source_times = np.asarray(video.times)
    rows = [
        row for track_id, observations in cleaned.items()
        for row in resample(
            track_id, observations, labels[track_id], source_times, calibration.rink, sample_fps=video.sample_fps,
        )
    ]
    rows.sort(key=lambda row: (row["t"], row["track_id"]))
    out.mkdir(parents=True, exist_ok=True)
    write_positions(out, rows)
    render_debug(video, out / "debug.mp4", calibration.rink, frames, labels, aliases, rows)
    period = period_summary(rows, calibration.rink, calibration.period, a_defends)
    elapsed = perf_counter() - start
    write_json(out / "summary.json", {
        "periods": [period],
        "processing_stats": {
            "source_frames": len(source_times), "processed_frames": len(frames), "elapsed_s": round(elapsed, 3),
        },
        "drift_warnings": drift.warnings,
    })
    return (
        f"{len(frames):,} sampled / {len(source_times):,} source frames in {elapsed:.1f} s; "
        f"{stats['kept']:,}/{stats['detections']:,} detections kept "
        f"({stats['detections'] - stats['kept']:,} rejected by ice/rink filter, "
        f"{stats['estimated']:,} estimated feet); {stats['tracked']:,} tracked detections; "
        f"{raw_ids:,} raw IDs → {len(cleaned):,} cleaned tracks → {len(rows):,} position rows. "
        f"Team A defends {'left' if a_defends == -1 else 'right'}. Outputs: {out}"
    )
