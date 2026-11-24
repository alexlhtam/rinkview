import { expect, it } from 'vitest';
import { makeClip } from './clips';

it('only saves a named range with an out point after its in point', () => {
  expect(makeClip(0, 4, '  Breakout ', '  Check the weak side ')).toEqual({
    start_s: 0, end_s: 4, title: 'Breakout', note: 'Check the weak side',
  });
  expect(makeClip(2, 1, 'Reverse', '')).toBeUndefined();
  expect(makeClip(null, 2, 'Missing start', '')).toBeUndefined();
  expect(makeClip(1, 2, ' ', '')).toBeUndefined();
});
