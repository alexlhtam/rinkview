import { expect, it } from 'vitest';
import { fitCalibration, imageToRink, rinkToImage } from './screenshotCalibration';
import type { LandmarkPair } from './screenshotCalibration';

it('fits named rink landmarks and projects off-landmark points in both directions', () => {
  const pairs: LandmarkPair[] = [
    { landmark_id: 'a', image_px: [200, 200], rink_m: [-10, 5] },
    { landmark_id: 'b', image_px: [600, 200], rink_m: [10, 5] },
    { landmark_id: 'c', image_px: [100, 400], rink_m: [-10, -5] },
    { landmark_id: 'd', image_px: [700, 400], rink_m: [10, -5] },
    { landmark_id: 'e', image_px: [400, 280], rink_m: [0, 0] },
  ];
  const result = fitCalibration(pairs, [800, 600], '../rink_templates/iihf.json');
  expect(result.reprojection_rms_m).toBeCloseTo(0, 8);
  expect(imageToRink([400, 350], result)[1]).toBeCloseTo(-35 / 11, 8);
  const point = rinkToImage([5, 0], result);
  expect(imageToRink(point, result)[0]).toBeCloseTo(5, 8);
  expect(imageToRink(point, result)[1]).toBeCloseTo(0, 8);
});

it('rejects collinear landmarks', () => {
  const pairs: LandmarkPair[] = Array.from({ length: 4 }, (_, i) =>
    ({ landmark_id: String(i), image_px: [10 * i, 10 * i], rink_m: [i, i] }));
  expect(() => fitCalibration(pairs, [800, 600], 'iihf.json')).toThrow('Spread');
});
