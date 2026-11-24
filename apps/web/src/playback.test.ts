import { expect, it } from 'vitest';
import { fallbackFrameTarget } from './playback';

it('steps one nominal frame at a time without accumulating the seek offset', () => {
  const fps = 59.94;
  let time = 0.8 / fps;
  for (let frame = 1; frame <= 15; frame++) {
    time = fallbackFrameTarget(time, 1, fps, 10);
    expect(time * fps).toBeCloseTo(frame + 0.25);
  }
  for (let frame = 14; frame >= 0; frame--) {
    time = fallbackFrameTarget(time, -1, fps, 10);
    expect(time * fps).toBeCloseTo(frame + 0.25);
  }
});

it('keeps fallback frame stepping inside the first and last frame', () => {
  const fps = 30;
  const duration = 10.1 / fps;
  const last = fallbackFrameTarget(9.5 / fps, 1, fps, duration);
  expect(last * fps).toBeCloseTo(10.05);
  expect(fallbackFrameTarget(last, 1, fps, duration)).toBe(last);
  expect(fallbackFrameTarget(0, -1, fps, duration) * fps).toBeCloseTo(0.25);
});
