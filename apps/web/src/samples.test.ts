import { describe, expect, it } from 'vitest';
import { effectiveTeam, estimateFps, findSample, groupSamples, trackTrails } from './samples';
import type { Position } from './contracts';

function row(t: number, id = 1): Position {
  return { t, frame: Math.round(t * 60), track_id: id, role: 'player', team: 'A',
    x_m: t, y_m: 0, vx: 1, vy: 0, conf: 1, on_ice: true, interpolated: false };
}

describe('position samples', () => {
  it('groups out-of-order rows and finds the closest sample after scrubbing, without holding stale dots', () => {
    const samples = groupSamples([row(0.2), row(0, 2), row(0), row(0.1)]);
    expect(findSample(samples, 0.13)?.time).toBe(0.1);
    expect(findSample(samples, 0.16)?.time).toBe(0.2);
    expect(findSample(samples, 0)?.positions).toHaveLength(2);
    expect(findSample(samples, 1)).toBeUndefined();
    expect(estimateFps(samples)).toBe(60);
  });

  it('limits trails to the requested lookback, on-ice visible tracks and contiguous samples', () => {
    const samples = groupSamples([row(0), row(0.1), row(0.2), row(0.3, 2), row(0.4), row(0.5)]);
    const segments = trackTrails(samples, 0.45, 0.36, new Set([1]));
    expect([...segments.keys()]).toEqual([1]);
    expect(segments.get(1)?.map(segment => segment.map(p => p.t))).toEqual([[0.1, 0.2], [0.4]]);
  });

  it('overrides team assignments across a track but keeps referees neutral', () => {
    const overrides = new Map([[1, 'B']] as const);
    expect(effectiveTeam(row(0), overrides)).toBe('B');
    expect(effectiveTeam(row(1), overrides)).toBe('B');
    expect(effectiveTeam({ ...row(0), role: 'referee' }, overrides)).toBe('none');
  });
});
