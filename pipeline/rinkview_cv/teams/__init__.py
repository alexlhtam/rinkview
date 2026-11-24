"""Classify tracks using clip-wide jersey colours and conservative role cues."""

from collections import Counter
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class Jersey:
    colours: np.ndarray
    stripes: bool
    plain_official: bool


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
    hsv = cv2.cvtColor(torso, cv2.COLOR_BGR2HSV)
    hue, saturation, value = hsv.reshape(-1, 3).T
    chromatic = (saturation >= 60) & (value >= 55)
    hue_hist = np.bincount(hue[chromatic] // 15, minlength=12) / len(hue)
    core = torso[:, torso.shape[1] // 9:torso.shape[1] - torso.shape[1] // 9]
    lightness, a, b = cv2.cvtColor(core, cv2.COLOR_BGR2LAB).reshape(-1, 3).T
    low, mid, high = np.quantile(lightness, [.25, .5, .75]) / 255
    colours = np.r_[mid, low, high, (np.median(a) - 128) / 64,
                    (np.median(b) - 128) / 32, np.sqrt(hue_hist)]
    gray = cv2.cvtColor(torso, cv2.COLOR_BGR2GRAY)
    columns = np.median(cv2.resize(gray, (24, 16)), axis=0)
    dark, light = columns < 85, columns > 145
    edges = int(np.count_nonzero(np.diff(dark.astype(int))))
    stripes = chromatic.mean() < .18 and dark.mean() >= .21 and light.mean() >= .21 and edges >= 5
    return Jersey(colours, bool(stripes), _plain_kit(image, box))


def _plain_kit(image, box):
    x1, y1, x2, y2 = box
    width, height = x2 - x1, y2 - y1
    if width > 1.08 * height:
        return False
    left = max(0, int(x1 + .33 * width))
    right = min(image.shape[1], int(x2 - .33 * width))
    top = max(0, int(y1))
    bottom = min(image.shape[0], int(y2))
    if right - left < 4 or bottom - top < 20:
        return False
    kit = cv2.cvtColor(image[top:bottom, left:right], cv2.COLOR_BGR2HSV)
    hue, sat, value = np.moveaxis(kit, -1, 0)
    n = len(kit)

    def band(rows, start, stop):
        return rows[int(start * n):int(stop * n)]

    cool = band((hue >= 75) & (hue < 160) & (sat >= 55), .2, .85)
    if cool.mean() > .12:
        return False
    profile = np.median(value, axis=1)
    if width <= .85 * height and (band(profile, .2, .85) < 128).mean() >= .77:
        return True
    shoulders = np.quantile(band(profile, .175, .375), .75)
    chest = np.quantile(band(profile, .325, .50), .25)
    trousers = np.median(band(profile, .575, .75))
    return bool(
        shoulders >= 150 and chest <= 110 and min(shoulders, trousers) - chest >= 40
        or shoulders >= 170 and chest <= 68 and np.median(band(profile, .65, .80)) >= 115
    )


def _looks_like_plain_official(observations):
    samples = [o for o in observations if o.jersey is not None and o.tracked.ice.on_ice]
    if len(samples) < 5 or samples[-1].t - samples[0].t < 1.5:
        return False
    if sum(o.jersey.plain_official for o in samples) < .65 * len(samples):
        return False
    low, high = np.quantile([o.tracked.ice.point for o in samples], [.1, .9], axis=0)
    return np.linalg.norm(high - low) >= 1.25


def _two_means(features, weights):
    if len(features) < 2:
        return None
    order = np.lexsort(features.T[::-1])
    cumulative = np.cumsum(weights[order])
    centres = features[order[np.searchsorted(cumulative, cumulative[-1] * np.array([.3, .7]))]]
    if np.sum((centres[0] - centres[1]) ** 2) < .05:
        average = np.average(features, weights=weights, axis=0)
        distance = ((features - average) ** 2).sum(axis=1)
        first = order[np.argmax((distance * weights)[order])]
        distance = ((features - features[first]) ** 2).sum(axis=1)
        second = order[np.argmax((distance * weights)[order])]
        if distance[second] < .05:
            return None
        centres = features[[first, second]]
    for _ in range(30):
        labels = ((features[:, None, :] - centres) ** 2).sum(axis=2).argmin(axis=1)
        if labels.min() == labels.max():
            return None
        new = np.array([np.average(features[mask], axis=0, weights=weights[mask])
                        for label in (0, 1) if (mask := labels == label).any()])
        if np.allclose(centres, new):
            break
        centres = new
    return np.asarray(sorted(centres, key=lambda centre: (-centre[0], *centre[1:])))


@dataclass(frozen=True)
class Assignment:
    role: str
    team: str


def _team_votes(observations, centres):
    distances = np.full((len(observations), 2), np.nan)
    weights = np.zeros(len(observations))
    for i, o in enumerate(observations):
        if o.jersey is not None:
            distances[i] = ((o.jersey.colours - centres) ** 2).sum(axis=1)
            weights[i] = o.tracked.ice.detection.conf
    return distances, weights


def _vote(distances, weights):
    valid = weights > 0
    if not valid.any():
        return "none"
    distances, weights = distances[valid], weights[valid]
    counts = np.bincount(distances.argmin(axis=1), weights=weights, minlength=2)
    winner = np.average(distances, axis=0, weights=weights).argmin() if counts[0] == counts[1] else counts.argmax()
    return "AB"[winner]


def _clear_team_switch(observations, distances, weights, gap):
    times = np.array([o.t for o in observations])
    margin = distances[:, 1] - distances[:, 0]
    strong = np.abs(margin) >= .20 * distances.sum(axis=1)
    evidence = np.where(strong, np.sign(margin) * weights, 0)
    signed = np.r_[0., np.cumsum(evidence)]
    support = np.r_[0., np.cumsum(weights)]
    counts = np.r_[0, np.cumsum(strong & (weights > 0))]
    best = None
    for i in np.flatnonzero(np.diff(times) >= gap) + 1:
        if times[i - 1] - times[0] < 1 or times[-1] - times[i] < 1:
            continue
        if counts[i] < 5 or counts[-1] - counts[i] < 5:
            continue
        before = signed[i] / support[i]
        after = (signed[-1] - signed[i]) / (support[-1] - support[i])
        if before * after < 0 and min(abs(before), abs(after)) >= .70:
            candidate = (min(abs(before), abs(after)), i, "A" if before > 0 else "B",
                         "A" if after > 0 else "B")
            if best is None or candidate > best:
                best = candidate
    return best[1:] if best else None


def classify(tracks, rink, a_defends=None, *, team_a_jersey="light", switch_gap=None):
    roles, goalie_end, goalie_candidates = {}, {}, {-1: [], 1: []}
    plain_officials = set()
    for track_id, observations in tracks.items():
        votes = Counter(o.tracked.ice.detection.role for o in observations)
        votes.pop("person", None)
        generic = not votes
        roles[track_id] = "player" if generic else votes.most_common(1)[0][0]
        if generic and _looks_like_plain_official(observations):
            plain_officials.add(track_id)
        confident = sorted(
            (o for o in observations if o.jersey is not None),
            key=lambda o: -o.tracked.ice.detection.conf,
        )
        best_crops = confident[:5]
        if generic and len(best_crops) >= 3 and sum(o.jersey.stripes for o in best_crops) >= .8 * len(best_crops):
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
        elif generic and duration >= 2 and fraction >= .82:
            goalie_candidates[end].append((duration * fraction, track_id))

    for end, candidates in goalie_candidates.items():
        if candidates and end not in goalie_end.values():
            _, track_id = max(candidates)
            roles[track_id] = "goalie"
            goalie_end[track_id] = end

    for track_id in plain_officials - goalie_end.keys():
        roles[track_id] = "referee"

    features, weights = [], []
    for track_id, observations in tracks.items():
        if roles[track_id] != "player":
            continue
        crops = [o for o in observations if o.jersey is not None and o.tracked.ice.detection.conf > 0]
        for o in crops:
            ice = o.tracked.ice
            x, y = ice.point
            centre_ice = ice.on_ice and abs(y) < .68 * rink.board_y(x)
            weights.append(ice.detection.conf * (1 if centre_ice else .06) / np.sqrt(len(crops)))
            features.append(o.jersey.colours)
    centres = _two_means(np.asarray(features), np.asarray(weights))
    if centres is not None and team_a_jersey == "dark":
        centres = centres[::-1]
    votes, switches, end_votes, goalie_votes = {}, {}, [], set()
    if centres is not None:
        for track_id, observations in tracks.items():
            if roles[track_id] == "referee":
                continue
            distances, confidence = _team_votes(observations, centres)
            votes[track_id] = _vote(distances, confidence)
            valid = confidence > 0
            if track_id in goalie_end and valid.any():
                end = goalie_end[track_id]
                goalie_votes.add((end, end if votes[track_id] == "A" else -end))
                margin = distances[valid, 1] - distances[valid, 0]
                end_votes.append(end * np.average(margin, weights=confidence[valid]))
            if roles[track_id] == "player" and switch_gap is not None:
                switch = _clear_team_switch(observations, distances, confidence, switch_gap)
                if switch:
                    switches[track_id] = switch

    if a_defends is None:
        if goalie_votes == {(-1, 1), (1, 1)}:
            a_defends = 1
        elif goalie_votes == {(-1, -1), (1, -1)}:
            a_defends = -1
        else:
            a_defends = 1 if sum(end_votes) > 0 else -1
    labels = {}
    for track_id, role in roles.items():
        if role == "referee":
            team = "none"
        elif role == "goalie":
            team = "A" if goalie_end[track_id] == a_defends else "B"
        else:
            team = votes.get(track_id, "none")
        labels[track_id] = Assignment(role, team)
    return labels, a_defends, switches
