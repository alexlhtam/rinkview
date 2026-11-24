import { expect, it } from 'vitest';
import rink from '../../../shared/rink_templates/ally-pally-estimate.json';
import { canvasProjection, heatmapCentroid, rinkGeometry } from './rinkGeometry';

it('places the rink on the pipeline axes and agrees with calibration landmarks', () => {
  const g = rinkGeometry(rink);
  expect(g.goalX).toBe(24);
  expect(g.boardY(g.blueX)).toBe(13);
  expect(g.neutralX).toBeCloseTo(5.43);
  expect(g.boardY(g.goalX)).toBeCloseTo(4 + Math.sqrt(56));
  const projection = canvasProjection(rink, g.paddedWidth * 10, g.paddedHeight * 10);
  expect(projection.x(0)).toBe(295);
  expect(projection.y(0)).toBe(145);
  expect(projection.y(13)).toBe(15);
});

it('uses cell centres in increasing world y for a weighted heatmap centroid', () => {
  expect(heatmapCentroid({ x_min_m: -2, y_min_m: -1, cell_size_m: 2, grid: [[0, 1], [3, 0]] }))
    .toEqual({ x: -0.5, y: 1.5 });
});
