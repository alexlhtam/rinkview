import { createClip } from '@rinkview/tactics-board/source';
import type { TeachingClip } from '@rinkview/tactics-board/source';
import type { GameData } from './data';
import type { Team } from './contracts';
import { SAMPLE_TOLERANCE, effectiveTeam, findSample } from './samples';

export interface TeachingDraft {
  clip: TeachingClip;
  savedClip: TeachingClip;
}

export function canDiscardTeachingDraft(current: TeachingDraft | null, confirmDiscard: () => boolean): boolean {
  return !current || current.clip === current.savedClip || confirmDiscard();
}

export function switchTeachingDraft(
  current: TeachingDraft | null, nextClip: TeachingClip, loadingClip: boolean, confirmDiscard: () => boolean,
): TeachingDraft | null {
  if (!loadingClip && current?.clip.start_t === nextClip.start_t) return current;
  if (!canDiscardTeachingDraft(current, confirmDiscard)) return null;
  return { clip: nextClip, savedClip: nextClip };
}

export async function teachingFrame(
  game: Pick<GameData, 'positions' | 'videoId'>, time: number, duration: number,
  overrides: ReadonlyMap<number, Team>, loaded?: TeachingClip,
) {
  if (loaded?.video_id && loaded.video_id !== game.videoId) {
    throw new Error('This Teaching Clip belongs to a different video file.');
  }
  const start = loaded?.start_t ?? Math.min(time, Math.max(0, duration - 1e-6));
  if (!Number.isFinite(start) || start < 0 || start >= duration) throw new Error('The teaching timestamp is outside this video.');
  const samples = await game.positions.readWindow(Math.max(0, start - SAMPLE_TOLERANCE), start + SAMPLE_TOLERANCE + 1e-6);
  const players = (findSample(samples, start)?.positions ?? []).filter(p => p.on_ice)
    .map(p => ({ ...p, team: effectiveTeam(p, overrides) }));
  const clip: TeachingClip = { ...(loaded ?? { ...createClip(start), end_t: Math.min(start + 4, duration) }), video_id: game.videoId };
  return { players, clip };
}
