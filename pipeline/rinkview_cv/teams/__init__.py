"""Classify whole tracks using confident jersey crops and conservative role cues."""

from collections import Counter
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class Jersey:
    colours: np.ndarray
    stripes: bool


def jersey_features(image, box):
    x1, y1, x2, y2 = box
    width, height = x2 - x1, y2 - y1
    left = max(0, int(x1 + .19 * width))
    right = min(image.shape[1], int(x2 - .19 * width))
    top = max(0, int(y1 + .24 * height))
    bottom = min(image.shape[0], int(y1 + .60 * height))
    if right - left < 4 or bottom - top < 4:
        return None
    torso = image[top:bottom, left:right]
    hue, saturation, value = cv2.cvtColor(torso, cv2.COLOR_BGR2HSV).reshape(-1, 3).T
    chromatic = (saturation >= 60) & (value >= 55)
    ice_white = (saturation < 48) & (value >= 185)
    hue_hist = np.bincount(hue[chromatic] // 15, minlength=12) / len(hue)
    neutral = ~chromatic & ~ice_white
    value_hist = np.bincount(value[neutral] // 64, minlength=4) / len(value)
    colours = np.sqrt(np.r_[hue_hist, value_hist])
    gray = cv2.cvtColor(torso, cv2.COLOR_BGR2GRAY)
    columns = np.median(cv2.resize(gray, (24, 16)), axis=0)
    dark, light = columns < 85, columns > 145
    edges = int(np.count_nonzero(np.diff(dark.astype(int))))
    stripes = chromatic.mean() < .18 and dark.mean() >= .21 and light.mean() >= .21 and edges >= 5
    return Jersey(colours, bool(stripes))


def two_means(features):
    features = np.asarray(features)
    if len(features) < 2:
        return None
    i = np.argmax(((features - features.mean(axis=0)) ** 2).sum(axis=1))
    distance = ((features - features[i]) ** 2).sum(axis=1)
    j = np.argmax(distance)
    if distance[j] < .05:
        return None
    centres = features[[i, j]]
    for _ in range(30):
        labels = ((features[:, None, :] - centres) ** 2).sum(axis=2).argmin(axis=1)
        if len(set(labels)) < 2:
            return None
        new = np.array([features[labels == label].mean(axis=0) for label in (0, 1)])
        if np.allclose(centres, new):
            break
        centres = new
    return np.asarray(sorted(centres, key=lambda centre: (-sum(centre[:12]), *centre)))


@dataclass(frozen=True)
class Assignment:
    role: str
    team: str


def classify(tracks, rink, a_defends=None):
    jerseys, centre_jerseys, roles, goalie_end, goalie_candidates = {}, {}, {}, {}, {-1: [], 1: []}
    for track_id, observations in tracks.items():
        votes = Counter(o.tracked.ice.detection.role for o in observations)
        roles[track_id] = votes.most_common(1)[0][0]
        confident = sorted(
            (o for o in observations if o.jersey is not None),
            key=lambda o: -o.tracked.ice.detection.conf,
        )
        away_from_boards = [
            o.jersey for o in confident if o.tracked.ice.on_ice
            and abs(o.tracked.ice.point[1]) < .68 * rink.board_y(o.tracked.ice.point[0])
        ][:5]
        if len(away_from_boards) >= 3:
            centre_jerseys[track_id] = np.mean([j.colours for j in away_from_boards], axis=0)
        jerseys[track_id] = [o.jersey for o in confident[:5]]
        if roles[track_id] == "player" and len(jerseys[track_id]) >= 3:
            if sum(j.stripes for j in jerseys[track_id]) >= .8 * len(jerseys[track_id]):
                roles[track_id] = "referee"
        if roles[track_id] == "referee":
            continue
        x, y = np.array([o.tracked.ice.point for o in observations]).T
        near_goal = (np.abs(np.abs(x) - rink.goal_x) < 4) & (np.abs(y) < 3.5)
        end = -1 if np.median(x) < 0 else 1
        fraction = float(np.mean(near_goal & (x * end > 0)))
        duration = observations[-1].t - observations[0].t
        if roles[track_id] == "goalie":
            goalie_end[track_id] = end
        elif duration >= 2 and fraction >= .82:
            goalie_candidates[end].append((duration * fraction, track_id))

    for end, candidates in goalie_candidates.items():
        if candidates and end not in goalie_end.values():
            _, track_id = max(candidates)
            roles[track_id] = "goalie"
            goalie_end[track_id] = end

    centres = two_means([feature for i, feature in centre_jerseys.items() if roles[i] == "player"])
    if centres is None:
        centres = two_means([
            np.mean([j.colours for j in jerseys[i]], axis=0)
            for i, role in roles.items() if role == "player" and jerseys[i]
        ])

    def vote(track_id):
        if centres is None or not jerseys[track_id]:
            return "none"
        distances = [
            ((j.colours - centres) ** 2).sum(axis=1)
            for j in jerseys[track_id]
        ]
        counts = np.bincount(np.argmin(distances, axis=1), minlength=2)
        winner = int(np.argmin(np.mean(distances, axis=0))) if counts[0] == counts[1] else int(counts.argmax())
        return "AB"[winner]

    if a_defends is None:
        end_votes = [end if team == "A" else -end for track_id, end in goalie_end.items()
                     if (team := vote(track_id)) != "none"]
        a_defends = 1 if sum(end_votes) > 0 else -1
    labels = {}
    for track_id, role in roles.items():
        if role == "referee":
            team = "none"
        elif role == "goalie":
            team = "A" if goalie_end[track_id] == a_defends else "B"
        else:
            team = vote(track_id)
        labels[track_id] = Assignment(role, team)
    return labels, a_defends
