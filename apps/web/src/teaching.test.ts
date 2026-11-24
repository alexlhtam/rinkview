import { describe, expect, it } from 'vitest';
import { parseClip, serializeClip } from '@rinkview/tactics-board/source';
import type { Position } from './contracts';
import { groupSamples } from './samples';
import { teachingFrame } from './teaching';

const player: Position = {
  t: 2.1, frame: 126, track_id: 8, x_m: 4, y_m: -4, vx: 0, vy: 0,
  role: 'player', team: 'A', conf: .8, interpolated: false, on_ice: true,
};
const samples = groupSamples([
  { ...player, t: 1.8, track_id: 1 },
  { ...player, interpolated: true },
  { ...player, track_id: 9, role: 'referee', team: 'none' },
  { ...player, track_id: 10, role: 'goalie', team: 'B' },
  { ...player, track_id: 11, team: 'none' },
  { ...player, track_id: 12, on_ice: false },
]);
const game = {
  videoId: 'period.mp4:1234',
  positions: {
    async readWindow(from: number, to: number) {
      return samples.filter(sample => from <= sample.time && sample.time < to);
    },
  },
};

describe('teaching frame', () => {
  it('uses the nearest sample without carrying fragmented tracks forward', async () => {
    const result = await teachingFrame(game, 2.08, 5, new Map([[8, 'B'], [9, 'A']]));
    expect(result.clip).toMatchObject({ start_t: 2.08, end_t: 5, video_id: game.videoId });
    expect(result.players.map(({ track_id, team, role, interpolated }) => [track_id, team, role, interpolated])).toEqual([
      [8, 'B', 'player', true], [9, 'none', 'referee', false], [10, 'B', 'goalie', false], [11, 'none', 'player', false],
    ]);
  });

  it('restores the snapshot at the saved video timestamp, not the current playhead', async () => {
    const { clip, players } = await teachingFrame(game, 2.08, 5, new Map());
    const loaded = parseClip(serializeClip({ ...clip, title: 'Defensive coverage' }));
    const restored = await teachingFrame(game, 4.2, 5, new Map(), loaded);
    expect(restored.clip).toEqual(loaded);
    expect(restored.players).toEqual(players);
    await expect(teachingFrame({ ...game, videoId: 'other.mp4:1' }, 2, 5, new Map(), loaded))
      .rejects.toThrow('different video file');
  });

  it('opens an empty board for a gap instead of guessing positions', async () => {
    const result = await teachingFrame(game, 4.2, 5, new Map());
    expect(result.players).toEqual([]);
  });
});
