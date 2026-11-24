"""Stitch compatible track fragments, filter their motion, and export at 10 Hz."""

from dataclasses import dataclass, replace
from math import ceil, floor

import numpy as np

from rinkview_cv.project.ice import clamp_to_rink
from rinkview_cv.teams import Assignment, Jersey
from rinkview_cv.track import Tracked

HZ = 10
MAX_SPEED = 12.0
MAX_GAP = 3.0


@dataclass(frozen=True)
class Observation:
    frame: int
    t: float
    tracked: Tracked
    jersey: Jersey | None


def split_team_switches(tracks, frames, labels, switches):
    if not switches:
        return
    next_id = max(tracks) + 1
    for track_id, (index, before, after) in sorted(switches.items()):
        tail = []
        for obs in tracks[track_id][index:]:
            tracked = replace(obs.tracked, track_id=next_id)
            tail.append(replace(obs, tracked=tracked))
            frames[obs.frame] = [tracked if item.track_id == track_id else item for item in frames[obs.frame]]
        tracks[track_id] = tracks[track_id][:index]
        tracks[next_id] = tail
        labels[track_id] = Assignment("player", before)
        labels[next_id] = Assignment("player", after)
        next_id += 1


def stitch(tracks, labels, fps):
    aliases = {track_id: track_id for track_id in tracks}
    combined = {}
    active = []
    for track_id in sorted(tracks, key=lambda i: tracks[i][0].t):
        track = tracks[track_id]
        label = labels[track_id]
        first = track[0]
        active = [i for i in active if first.t - combined[i][-1].t < MAX_GAP]
        scores = []
        for other in active:
            previous = combined[other]
            last = previous[-1]
            gap = first.t - last.t
            if gap <= 0 or label != labels[other] or label.team == "none":
                continue
            if first.tracked.ice.on_ice != last.tracked.ice.on_ice:
                continue
            target = np.asarray(first.tracked.ice.point)
            end = np.asarray(last.tracked.ice.point)
            distance = np.linalg.norm(target - end)
            if distance > MAX_SPEED * gap:
                continue
            earlier = next((o for o in reversed(previous[:-1]) if last.t - o.t >= .3), None)
            velocity = (end - earlier.tracked.ice.point) / (last.t - earlier.t) if earlier else np.zeros(2)
            velocity *= MAX_SPEED / max(MAX_SPEED, np.linalg.norm(velocity))
            error = np.linalg.norm(target - (end + velocity * min(1, gap)))
            if error <= 1 + 3 * gap:
                scores.append((error + .2 * distance + gap, other))
        if scores:
            _, root = min(scores)
            aliases[track_id] = root
            combined[root].extend(track)
        else:
            combined[track_id] = list(track)
            active.append(track_id)
    return {
        track_id: observations for track_id, observations in combined.items()
        if sum(min(1 / fps, b.t - a.t) for a, b in zip(observations, observations[1:])) + 1 / fps >= 1 - .01
    }, aliases


def kalman(times, points, confidence):
    state = np.r_[points[0], [0., 0.]]
    covariance = np.diag([.64, .64, 16., 16.])
    output = [state.copy()]
    for dt, point, conf in zip(np.diff(times), points[1:], confidence[1:]):
        transition = np.eye(4)
        transition[:2, 2:] = dt * np.eye(2)
        acceleration = np.vstack([.5 * dt**2 * np.eye(2), dt * np.eye(2)])
        prediction = transition @ state
        covariance = transition @ covariance @ transition.T + 16 * acceleration @ acceleration.T
        noise = (.35 / max(.2, conf)) ** 2 * np.eye(2)
        gain = np.linalg.solve(covariance[:2, :2] + noise, covariance[:2, :]).T
        updated = prediction + gain @ (point - prediction[:2])
        delta = updated[:2] - state[:2]
        updated[:2] = state[:2] + delta * (MAX_SPEED * dt / max(MAX_SPEED * dt, np.linalg.norm(delta)))
        velocity = updated[2:]
        updated[2:] = velocity * (MAX_SPEED / max(MAX_SPEED, np.linalg.norm(velocity)))
        covariance -= gain @ covariance[:2, :]
        state = updated
        output.append(state.copy())
    return np.asarray(output)


def nearest_index(clock, t):
    right = min(len(clock) - 1, int(np.searchsorted(clock, t)))
    left = max(0, right - 1)
    return left if abs(clock[left] - t) <= abs(clock[right] - t) else right


def resample(track_id: int, observations: list[Observation], label: Assignment, source_times, rink, *, sample_fps):
    rows = []
    observed_tolerance = .5 / max(HZ, sample_fps)
    splits = [i for i in range(1, len(observations)) if (
        observations[i].t - observations[i - 1].t >= MAX_GAP
        or observations[i].tracked.ice.on_ice != observations[i - 1].tracked.ice.on_ice
    )]
    for start, end in zip([0, *splits], [*splits, len(observations)]):
        segment = observations[start:end]
        times = np.array([o.t for o in segment])
        conf = np.array([o.tracked.ice.detection.conf for o in segment])
        points = np.array([o.tracked.ice.point for o in segment])
        filtered = kalman(times, points, conf)
        on_ice = segment[0].tracked.ice.on_ice
        if on_ice:
            filtered[:, :2] = clamp_to_rink(filtered[:, :2], rink)
        for tick in range(ceil(HZ * times[0] - 1e-8), floor(HZ * times[-1] + 1e-8) + 1):
            t = tick / HZ
            x, y, vx, vy = (float(np.float32(np.interp(t, times, field))) for field in filtered.T)
            nearest = nearest_index(times, t)
            rows.append({
                "t": t, "frame": nearest_index(source_times, t), "track_id": track_id,
                "role": label.role, "team": label.team, "x_m": x, "y_m": y, "vx": vx, "vy": vy,
                "conf": float(np.float32(np.interp(t, times, conf))), "on_ice": on_ice,
                "interpolated": bool(abs(t - times[nearest]) >= observed_tolerance - 1e-8),
            })
    return rows
