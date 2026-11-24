import json
import sys
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import cv2
import jsonschema
import numpy as np
import pytest

av = pytest.importorskip("av")
pq = pytest.importorskip("pyarrow.parquet")
pytest.importorskip("supervision")

from rinkview_cv.calib import load_rink_template
from rinkview_cv.detect import Detection, YoloDetector, horizontal_tiles
from rinkview_cv.export import POSITIONS
from rinkview_cv.io import sample_clock
from rinkview_cv.process import process_video
from rinkview_cv.project.ice import Calibration, IceDetection, IceFilter, clamp_to_rink
from rinkview_cv.teams import Assignment, classify, jersey_features
from rinkview_cv.track import Tracked, Tracker
from rinkview_cv.track.positions import Observation, resample, stitch

SHARED = Path(__file__).resolve().parents[2] / "shared"


@pytest.fixture
def rink():
    return load_rink_template(SHARED / "rink_templates" / "ally-pally-estimate.json")


def test_sampling_with_irregular_timestamps_and_detector_tiles():
    frames = [(index, stamp, None) for index, stamp in enumerate([0., .026, .19, .21, .53, .54, .61])]
    assert [i for i, _, _ in sample_clock(frames, 5)] == [0, 3, 4, 6]
    tiles = list(horizontal_tiles((20, 100, 3860, 600)))
    assert tiles[0][:2] == (20, 100)
    assert tiles[-1][2:] == (3860, 600)
    assert all(a[2] - b[0] >= 256 for a, b in zip(tiles, tiles[1:]))


def test_yolo_adapter_preserves_custom_roles_and_full_frame_coordinates(monkeypatch):
    class FakeModel:
        names = {0: "player", 1: "goalie", 2: "referee", 3: "puck", 4: "person"}

        def __init__(self, weights):
            assert weights == "test.pt"

        def predict(self, tiles, **kwargs):
            assert [tile.shape for tile in tiles] == [(90, 80, 3)]
            assert kwargs["classes"] == [0, 1, 2, 4]
            assert kwargs["device"] == "0"
            boxes = np.array([[1, 3, 6, 8, .8, 2], [10, 3, 16, 8, .7, 4]])
            data = SimpleNamespace(cpu=lambda: SimpleNamespace(numpy=lambda: boxes))
            return [SimpleNamespace(boxes=SimpleNamespace(data=data))]

    monkeypatch.setitem(sys.modules, "ultralytics", SimpleNamespace(YOLO=FakeModel))
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True)))
    detector = YoloDetector("cuda", "test.pt")
    assert detector.detect(np.zeros((150, 150, 3), np.uint8), (20, 30, 100, 120)) == [
        Detection((21, 33, 26, 38), .8, "referee"),
        Detection((30, 33, 36, 38), .7, "person"),
    ]


@pytest.mark.parametrize("same_tile", [True, False], ids=["within-tile", "across-tiles"])
def test_tile_dedup_uses_class_only_within_a_tile(same_tile):
    def result(boxes):
        data = SimpleNamespace(cpu=lambda: SimpleNamespace(numpy=lambda: np.array(boxes)))
        return SimpleNamespace(boxes=SimpleNamespace(data=data))

    detector = YoloDetector.__new__(YoloDetector)
    detector.device = "cpu"
    detector.roles = {0: "player", 1: "goalie"}
    first = [[1200, 20, 1240, 80, .9, 0], [1200, 20, 1240, 80, .8, 0]]
    second = [[136, 20, 176, 80, .6, 0]]
    expected = [Detection((1200, 20, 1240, 80), .9, "player")]
    if same_tile:
        first.append([1200, 20, 1240, 80, .7, 1])
        expected.append(Detection((1200, 20, 1240, 80), .7, "goalie"))
    else:
        second.append([136, 20, 176, 80, .7, 1])
    detector.model = SimpleNamespace(predict=lambda *_args, **_kwargs: [result(first), result(second)])
    assert detector.detect(np.zeros((160, 2600, 3), np.uint8), (0, 0, 2600, 160)) == expected


def test_ice_mask_board_fallback_and_rounded_corner(rink):
    calib = Calibration(
        rink, (3840, 2160), np.array([[.1, 0, -30], [0, -.05, 15], [0, 0, 1]]),
        np.array([[100, 100], [500, 100], [500, 400], [100, 400]], np.float32),
        None, 1, True, (),
    )
    filter_ice = IceFilter(calib)
    mentor = Detection((280, 220, 320, 320), .8)
    for _ in range(8):
        assert filter_ice.apply([mentor])[0].foot == (300, 317)
    clipped = Detection((280, 299, 320, 377), .9)
    spectator = Detection((280, 360, 320, 460), .9)
    outside = Detection((35, 235, 65, 310), .9)
    (result,) = filter_ice.apply([clipped, spectator, outside])
    assert result.detection is clipped and result.estimated and result.on_ice
    assert result.foot == (300, 396)
    assert result.point == pytest.approx((0, -4.8))
    assert filter_ice.apply([Detection((280, 320, 320, 396), .9)])[0].estimated is False

    point = clamp_to_rink([rink.length_m / 2, rink.width_m / 2], rink)
    assert point[1] == pytest.approx(rink.board_y(point[0]))


def test_bytetrack_handles_empty_frame():
    tracker = Tracker(5)
    ice = IceDetection(Detection((10, 10, 30, 30), .9), (20, 29), (0, 0), True, False)
    first = tracker.update([ice])
    assert len(first) == 1
    assert tracker.update([]) == []
    assert tracker.update([ice])[0].track_id == first[0].track_id


def test_bytetrack_keeps_original_boxes_at_sparse_sample_rates():
    tracker = Tracker(5)
    a = IceDetection(Detection((10, 10, 30, 34), .9), (20, 33), (0, 0), True, False)
    b = IceDetection(Detection((27, 10, 47, 34), .9), (37, 33), (1, 0), True, False)
    first, = tracker.update([a])
    second, = tracker.update([b])
    assert first.track_id == second.track_id
    assert second.ice is b


def observations(t0, count, track_id, color, x0=0, y0=0, role="player", step=.2):
    image = np.full((60, 40, 3), color, np.uint8)
    detection = Detection((0, 0, 40, 60), .9, role)
    jersey = jersey_features(image, detection.xyxy)
    return [
        Observation(round(30 * t), t, Tracked(track_id, IceDetection(
            detection, (20, 58), (x0 + i * .2, y0), True, False,
        )), jersey)
        for i in range(count) if (t := t0 + step * i) >= 0
    ]


def test_classification_and_explicit_roles(rink):
    navy, pale = (155, 60, 30), (245, 245, 245)
    tracks = {
        1: observations(0, 10, 1, navy),
        2: observations(0, 10, 2, pale),
        3: observations(0, 10, 3, pale, x0=rink.goal_x, role="goalie"),
        4: observations(0, 10, 4, navy, role="referee"),
    }
    assigned, side = classify(tracks, rink)
    assert assigned == {
        1: Assignment("player", "A"), 2: Assignment("player", "B"),
        3: Assignment("goalie", "B"), 4: Assignment("referee", "none"),
    }
    assert side == -1
    assert classify(tracks, rink, a_defends=1)[0][3] == Assignment("goalie", "A")


def test_team_fit_ignores_outlier_jerseys_at_the_boards_when_possible(rink):
    tracks = {
        1: observations(0, 10, 1, (170, 80, 35)),
        2: observations(0, 10, 2, (110, 175, 220)),
    }
    for track_id in range(3, 9):
        tracks[track_id] = observations(0, 10, track_id, (50, 180, 85), y0=-11)
    labels, _ = classify(tracks, rink)
    assert {labels[1].team, labels[2].team} == {"A", "B"}


def test_goalie_heuristic_only_relabels_generic_people(rink):
    pale = (245, 245, 245)
    tracks = {
        1: observations(0, 12, 1, pale, x0=-rink.goal_x, role="player"),
        2: observations(0, 12, 2, pale, x0=rink.goal_x, role="person"),
    }
    assigned, _ = classify(tracks, rink)
    assert assigned[1].role == "player"
    assert assigned[2].role == "goalie"


def test_jersey_features_detect_stripes_and_plain_official_kits():
    box = (0, 0, 36, 80)
    dark = np.full((80, 36, 3), 74, np.uint8)
    colour_block = dark.copy()
    colour_block[16:28] = 215
    colour_block[44:] = 176
    striped = dark.copy()
    striped[:, ::4] = 190
    striped[:, 1::4] = 190
    skater = dark.copy()
    skater[16:33] = (190, 145, 50)
    skater[53:] = 224

    assert jersey_features(dark, box).plain_official
    assert jersey_features(colour_block, box).plain_official
    assert jersey_features(striped, box).stripes
    assert not jersey_features(dark, box).stripes
    assert not jersey_features(skater, box).plain_official
    assert not jersey_features(skater, box).stripes


def test_plain_official_requires_track_consensus_and_on_ice_motion(rink):
    dark, pale, blue = (74, 74, 74), (245, 245, 245), (155, 60, 30)
    moving = observations(0, 12, 1, dark, role="person")
    pale_jersey = observations(0, 1, 2, pale)[0].jersey
    static = [replace(o, tracked=replace(o.tracked, ice=replace(o.tracked.ice, point=(0, 0))))
              for o in observations(0, 12, 3, dark, role="person")]
    off_ice = [replace(o, tracked=replace(o.tracked, ice=replace(o.tracked.ice, on_ice=False)))
               for o in observations(0, 12, 4, dark, role="person")]
    mixed = observations(0, 12, 2, dark, role="person")
    tracks = {
        1: [replace(o, jersey=pale_jersey) if i in (1, 4, 8) else o for i, o in enumerate(moving)],
        2: [replace(o, jersey=pale_jersey) if i % 2 else o for i, o in enumerate(mixed)],
        3: static,
        4: off_ice,
        5: observations(0, 12, 5, dark),
        6: observations(0, 12, 6, pale),
        7: observations(0, 12, 7, blue),
        8: observations(0, 12, 8, dark, role="person", step=.1),
    }
    assigned, _ = classify(tracks, rink)
    assert assigned[1] == Assignment("referee", "none")
    assert all(assigned[i].role == "player" for i in range(2, 9))
    game_labels, _ = classify({i: tracks[i] for i in (1, 6, 7)}, rink)
    assert {game_labels[6].team, game_labels[7].team} == {"A", "B"}


def test_stitch_filter_and_resample_without_extrapolation(rink):
    navy, pale = (155, 60, 30), (245, 245, 245)
    tracks = {
        1: observations(0, 3, 1, navy),
        2: observations(1.0, 5, 2, navy, x0=1),
        3: observations(.8, 2, 3, pale, x0=1, y0=1),
        4: observations(2.1, 2, 4, navy, x0=20),
    }
    labels = {i: Assignment("player", "A" if i != 3 else "B") for i in tracks}
    merged, aliases = stitch(tracks, labels, 5)
    assert aliases == {1: 1, 2: 1, 3: 3, 4: 4}
    assert set(merged) == {1}
    rows = resample(1, merged[1], labels[1], np.arange(90) / 30, rink, sample_fps=5)
    assert [row["t"] for row in rows] == [i / 10 for i in range(19)]
    assert [row["frame"] for row in rows] == [i * 3 for i in range(19)]
    assert rows[1]["interpolated"] and rows[6]["interpolated"]
    assert not rows[0]["interpolated"] and not rows[10]["interpolated"]
    assert all(np.hypot(row["vx"], row["vy"]) <= 12.000001 for row in rows)


def test_resample_marks_missing_tick_with_twenty_fps_neighbours(rink):
    track = observations(0, 5, 1, (155, 60, 30), step=.05)
    del track[2]
    rows = resample(1, track, Assignment("player", "A"), np.arange(5) / 20, rink, sample_fps=20)
    assert [(row["t"], row["interpolated"]) for row in rows] == [
        (0.0, False), (0.1, True), (0.2, False),
    ]


def test_process_with_synthetic_detector_and_video(tmp_path):
    video = tmp_path / "source.mp4"
    with av.open(str(video), mode="w") as container:
        stream = container.add_stream("libx264", rate=20)
        stream.width, stream.height, stream.pix_fmt = 320, 180, "yuv420p"
        image = np.full((180, 320, 3), 245, dtype=np.uint8)
        cv2.rectangle(image, (105, 70), (134, 130), (160, 65, 30), -1)
        cv2.rectangle(image, (185, 70), (214, 130), (237, 237, 237), -1)
        for _ in range(40):
            for packet in stream.encode(av.VideoFrame.from_ndarray(image, format="bgr24")):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)

    calib = tmp_path / "calib.json"
    calib.write_text(json.dumps({
        "image_size": [320, 180],
        "rink_template": str(SHARED / "rink_templates" / "ally-pally-estimate.json"),
        "source": {"period": 2},
        "ice_mask_polygon": [[70, 60], [250, 60], [250, 140], [70, 140]],
        "homography": [[.25, 0, -40], [0, -.2, 24], [0, 0, 1]],
    }), encoding="utf-8")

    class FakeDetector:
        def detect(self, image, crop):
            assert image.shape == (180, 320, 3)
            assert crop[0] <= 70 and crop[2] >= 250
            return [
                Detection((105, 70, 134, 130), .95), Detection((185, 70, 214, 130), .9),
                Detection((185, 95, 214, 170), .86),
            ]

    out = tmp_path / "out"
    status = process_video(video, calib, out, FakeDetector(), 5, -1)
    assert "20/30 detections kept" in status
    rows = json.loads((out / "positions.json").read_text())
    summary = json.loads((out / "summary.json").read_text())
    for name, result in [("positions", rows), ("summary", summary)]:
        schema = json.loads((SHARED / "schemas" / f"{name}.schema.json").read_text())
        jsonschema.validate(result, schema)
    table = pq.read_table(out / "positions.parquet")
    assert table.schema == POSITIONS
    assert table.to_pylist() == rows
    assert len(rows) == 38
    period = summary["periods"][0]
    assert period["period"] == 2
    assert period["track_counts"] == {"A": 1, "B": 1, "none": 0}
    assert period["zone_time"]["A"]["defensive_s"] == period["zone_time"]["B"]["defensive_s"] == 1.9
    assert np.sum(period["heatmaps"]["A"]["grid"]) == pytest.approx(1.9)
    assert summary["processing_stats"]["source_frames"] == 40
    with av.open(str(out / "debug.mp4")) as debug:
        assert debug.streams.video[0].codec_context.name == "h264"
        assert len(list(debug.decode(video=0))) == 10


@pytest.mark.parametrize(("video_name", "calib_name"), [
    ("debug.mp4", "calib.json"),
    ("source.mp4", "positions.json"),
    ("source.mp4", "summary.json"),
    ("positions.parquet", "calib.json"),
])
def test_process_rejects_output_overwriting_inputs(tmp_path, video_name, calib_name):
    video, calib = tmp_path / video_name, tmp_path / calib_name
    video.write_bytes(b"source video")
    calib.write_bytes(b"calibration")
    with pytest.raises(ValueError, match="would be overwritten by output"):
        process_video(video, calib, tmp_path, None, 5)
    assert video.read_bytes() == b"source video"
    assert calib.read_bytes() == b"calibration"
