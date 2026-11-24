import { describe, expect, it, vi } from 'vitest';
import { parseClip, serializeClip } from '@rinkview/tactics-board/source';
import type { Position } from './contracts';
import { groupSamples } from './samples';
import { switchTeachingDraft, teachingFrame } from './teaching';

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

describe('teaching draft', () => {
  it('restores edits when refreezing the same frame without asking to discard them', async () => {
    const { clip } = await teachingFrame(game, 2.08, 5, new Map());
    const draft = { clip: { ...clip, title: 'Defensive coverage' }, savedClip: clip };
    const sameFrame = await teachingFrame(game, 2.08, 5, new Map());
    const confirmDiscard = vi.fn(() => false);
    expect(switchTeachingDraft(draft, sameFrame.clip, false, 60, confirmDiscard)).toBe(draft);
    expect(confirmDiscard).not.toHaveBeenCalled();
  });

  it('restores a late-in-frame imported draft only on the same displayed frame', async () => {
    const fps = 60;
    const frame = 126;
    const { clip } = await teachingFrame(game, (frame + .9) / fps, 5, new Map());
    const imported = parseClip(serializeClip(clip));
    const draft = { clip: { ...imported, title: 'Defensive coverage' }, savedClip: imported };
    const displayedFrame = await teachingFrame(game, (frame - 1e-9) / fps, 5, new Map());
    const nextFrame = await teachingFrame(game, (frame + 1) / fps, 5, new Map());
    const confirmDiscard = vi.fn(() => false);

    expect(switchTeachingDraft(draft, displayedFrame.clip, false, fps, confirmDiscard)).toBe(draft);
    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(switchTeachingDraft(draft, nextFrame.clip, false, fps, confirmDiscard)).toBeNull();
    expect(confirmDiscard).toHaveBeenCalledOnce();
    expect(switchTeachingDraft(draft, nextFrame.clip, false, fps, () => true)?.clip).toBe(nextFrame.clip);
  });

  it('keeps unsaved edits on cancel and switches to a different frame on confirmation', async () => {
    const { clip } = await teachingFrame(game, 2.08, 5, new Map());
    const draft = { clip: { ...clip, notes: 'Cover the slot' }, savedClip: clip };
    const differentFrame = await teachingFrame(game, 4.2, 5, new Map());
    const confirmDiscard = vi.fn(() => false).mockReturnValueOnce(false).mockReturnValueOnce(true);
    expect(switchTeachingDraft(draft, differentFrame.clip, false, 60, confirmDiscard)).toBeNull();
    expect(switchTeachingDraft(draft, clip, false, 60, confirmDiscard)).toBe(draft);
    expect(switchTeachingDraft(draft, differentFrame.clip, false, 60, confirmDiscard))
      .toEqual({ clip: differentFrame.clip, savedClip: differentFrame.clip });
    expect(confirmDiscard).toHaveBeenCalledTimes(2);
  });

  it('does not warn after the current edits have been saved', async () => {
    const { clip } = await teachingFrame(game, 2.08, 5, new Map());
    const saved = { ...clip, title: 'Defensive coverage' };
    const differentFrame = await teachingFrame(game, 4.2, 5, new Map());
    const confirmDiscard = vi.fn(() => false);
    expect(switchTeachingDraft({ clip: saved, savedClip: saved }, differentFrame.clip, false, 60, confirmDiscard))
      .toEqual({ clip: differentFrame.clip, savedClip: differentFrame.clip });
    expect(confirmDiscard).not.toHaveBeenCalled();
  });
});
