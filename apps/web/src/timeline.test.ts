import { expect, it } from 'vitest';
import { activityBars } from './timeline';

it('places bins at their source times and clips the last visible bin without compressing the chart', () => {
  const activity = { start: 10, end: 90, bins: [1, 5, 100, 200] };
  expect(activityBars(activity, 40)).toEqual([
    { left: 25, width: 50, height: 20 },
    { left: 75, width: 25, height: 100 },
  ]);
  expect(activityBars(activity, 10)).toEqual([]);
});

it('leaves the rest of the timeline empty when tracking ends early', () => {
  expect(activityBars({ start: 5, end: 10, bins: [4] }, 20))
    .toEqual([{ left: 25, width: 25, height: 100 }]);
});
