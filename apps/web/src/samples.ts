import type { Position, Team } from './contracts';

export const SAMPLE_HZ = 10;
export const SAMPLE_TOLERANCE = 1.5 / SAMPLE_HZ;
export const WINDOW_SECONDS = 60;
export const MAX_TRAIL_SECONDS = 5;

export interface Sample {
  time: number;
  positions: Position[];
}

export function groupSamples(rows: Position[]): Sample[] {
  const byTime = new Map<number, Position[]>();
  for (const row of rows) {
    const existing = byTime.get(row.t);
    if (existing) existing.push(row);
    else byTime.set(row.t, [row]);
  }
  return Array.from(byTime, ([time, positions]) => ({ time, positions })).sort((a, b) => a.time - b.time);
}

export function lowerBound(samples: Sample[], time: number): number {
  let lo = 0;
  let hi = samples.length;
  while (lo < hi) {
    const middle = (lo + hi) >>> 1;
    if (samples[middle].time < time) lo = middle + 1;
    else hi = middle;
  }
  return lo;
}

export function findSample(samples: Sample[], time: number): Sample | undefined {
  const right = lowerBound(samples, time);
  const before = samples[right - 1];
  const after = samples[right];
  const nearest = !before || (after && after.time - time < time - before.time) ? after : before;
  return nearest && Math.abs(nearest.time - time) <= SAMPLE_TOLERANCE ? nearest : undefined;
}

export function trackTrails(samples: Sample[], time: number, seconds: number, visible: Set<number>) {
  const paths = new Map<number, Position[][]>();
  if (!seconds) return paths;
  for (let i = lowerBound(samples, time - seconds); i < samples.length && samples[i].time <= time; i++) {
    for (const row of samples[i].positions) {
      if (!row.on_ice || !visible.has(row.track_id)) continue;
      let segments = paths.get(row.track_id);
      if (!segments) {
        segments = [[]];
        paths.set(row.track_id, segments);
      }
      let path = segments[segments.length - 1];
      if (path.length && row.t - path[path.length - 1].t > SAMPLE_TOLERANCE) {
        path = [];
        segments.push(path);
      }
      path.push(row);
    }
  }
  return paths;
}

export function effectiveTeam(position: Position, overrides: ReadonlyMap<number, Team>): Team {
  return position.role === 'referee' ? 'none' : overrides.get(position.track_id) ?? position.team;
}

export function estimateFps(samples: Sample[]): number | undefined {
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last || first.time === last.time) return undefined;
  const fps = (last.positions[0].frame - first.positions[0].frame) / (last.time - first.time);
  if (fps <= 0) return undefined;
  const standardRate = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120]
    .sort((a, b) => Math.abs(a - fps) - Math.abs(b - fps))[0];
  return Math.abs(fps - standardRate) < 0.2 ? standardRate : fps;
}
