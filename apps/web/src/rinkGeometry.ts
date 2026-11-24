import type { Heatmap, RinkTemplate } from './contracts';

export const RINK_PADDING = 1.5;
export const TEAM_COLORS = { A: '#d73155', B: '#2264e5', none: '#64758b' };

export function rinkGeometry(rink: RinkTemplate) {
  const x = rink.length_m / 2;
  const y = rink.width_m / 2;
  const r = rink.corner_radius_m;
  const goalX = x - rink.goal_line_from_end_m;
  const blueX = rink.blue_line_from_centre_m;
  const boardY = (lineX: number) => {
    const offset = Math.max(0, Math.abs(lineX) - (x - r));
    return y - r + Math.sqrt(Math.max(0, r * r - offset * offset));
  };
  return {
    x, y, r, goalX, blueX, boardY,
    endX: goalX - rink.end_faceoff.from_goal_line_m,
    neutralX: blueX - rink.neutral_faceoff.from_blue_line_m,
    goalHalfWidth: (rink.goal_width_m ?? 1.8288) / 2,
    paddedWidth: rink.length_m + 2 * RINK_PADDING,
    paddedHeight: rink.width_m + 2 * RINK_PADDING,
  };
}

export function canvasProjection(rink: RinkTemplate, width: number, height: number) {
  const geometry = rinkGeometry(rink);
  const scale = Math.min(width / geometry.paddedWidth, height / geometry.paddedHeight);
  return { x: (m: number) => width / 2 + m * scale, y: (m: number) => height / 2 - m * scale, scale };
}

export function heatmapCentroid(heatmap: Heatmap) {
  const { grid, x_min_m, y_min_m, cell_size_m } = heatmap;
  let x = 0;
  let y = 0;
  let weight = 0;
  grid.forEach((row, j) => row.forEach((value, i) => {
    weight += value;
    x += (x_min_m + (i + 0.5) * cell_size_m) * value;
    y += (y_min_m + (j + 0.5) * cell_size_m) * value;
  }));
  return weight ? { x: x / weight, y: y / weight } : undefined;
}
