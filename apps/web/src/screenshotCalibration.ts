import type { RinkTemplate } from './contracts';
import { rinkGeometry } from './rinkGeometry';

export type Point = [number, number];
type Matrix = [number[], number[], number[]];
type Radial = { centre_px: Point; scale_px: number; k: number };
export type LandmarkPair = { landmark_id: string; image_px: Point; rink_m: Point; error_m?: number; inlier?: boolean };
export interface ScreenshotCalibration {
  id: string;
  rink_template: string;
  image_size: Point;
  homography: Matrix;
  radial_correction?: Radial;
  point_pairs?: LandmarkPair[];
  reprojection_rms_m?: number;
  ice_mask_polygon?: Point[];
}

function project([x, y]: Point, matrix: Matrix): Point {
  const [a, b, c] = matrix;
  const w = c[0] * x + c[1] * y + c[2];
  if (Math.abs(w) < 1e-12) throw new Error('Point projects to infinity.');
  return [(a[0] * x + a[1] * y + a[2]) / w, (b[0] * x + b[1] * y + b[2]) / w];
}

function inverse([[a, b, c], [d, e, f], [g, h, i]]: Matrix): Matrix {
  const result: Matrix = [[e*i-f*h, c*h-b*i, b*f-c*e], [f*g-d*i, a*i-c*g, c*d-a*f], [d*h-e*g, b*g-a*h, a*e-b*d]];
  const det = a * result[0][0] + b * result[1][0] + c * result[2][0];
  if (!det || !Number.isFinite(det)) throw new Error('Invalid homography; spread your landmarks across the rink.');
  return result.map(row => row.map(value => value / det)) as Matrix;
}

function radial(point: Point, correction: Radial | undefined, reverse: boolean): Point {
  if (!correction?.k) return point;
  const { centre_px: [cx, cy], scale_px: scale, k } = correction;
  const dx = (point[0] - cx) / scale, dy = (point[1] - cy) / scale;
  const r = Math.hypot(dx, dy);
  const root = Math.sqrt(3 * k);
  const ratio = reverse && r ? 2 * Math.sinh(Math.asinh(1.5 * root * r) / 3) / (root * r) : 1 + k * r * r;
  return [cx + scale * dx * ratio, cy + scale * dy * ratio];
}

export function imageToRink(point: Point, calibration: ScreenshotCalibration): Point {
  return project(radial(point, calibration.radial_correction, false), calibration.homography);
}

export function rinkToImage(point: Point, calibration: ScreenshotCalibration): Point {
  return radial(project(point, inverse(calibration.homography)), calibration.radial_correction, true);
}

function leastSquares(rows: number[][], values: number[]) {
  const n = rows[0].length;
  const system = Array.from({ length: n }, (_, i) => Array.from({ length: n + 1 }, (_, j) =>
    rows.reduce((total, row, r) => total + row[i] * (j === n ? values[r] : row[j]), 0)));
  for (let i = 0; i < n; i++) {
    const pivot = system.reduce((best, row, j) => j > i && Math.abs(row[i]) > Math.abs(system[best][i]) ? j : best, i);
    [system[i], system[pivot]] = [system[pivot], system[i]];
    const scale = system[i][i];
    if (Math.abs(scale) < 1e-10) throw new Error('Spread at least four landmarks across the rink, not on one line.');
    system[i] = system[i].map(value => value / scale);
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const factor = system[j][i];
      system[j] = system[j].map((value, k) => value - factor * system[i][k]);
    }
  }
  return system.map(row => row[n]);
}

export function fitCalibration(pairs: LandmarkPair[], size: Point, template: string): ScreenshotCalibration {
  if (pairs.length < 4) throw new Error('Choose at least four named landmarks.');
  const [cx, cy] = [size[0] / 2, size[1] / 2];
  const scale = Math.max(...size);
  const rows: number[][] = [], values: number[] = [];
  for (const { image_px: [px, py], rink_m: [u, v] } of pairs) {
    const x = (px - cx) / scale, y = (py - cy) / scale;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(u, v);
  }
  const [a,b,c,d,e,f,g,h] = leastSquares(rows, values);
  const homography: Matrix = [[a/scale, b/scale, c-(a*cx+b*cy)/scale],
    [d/scale, e/scale, f-(d*cx+e*cy)/scale], [g/scale, h/scale, 1-(g*cx+h*cy)/scale]];
  inverse(homography);
  const config: ScreenshotCalibration = { id: 'screenshot-calibration', rink_template: template, homography, image_size: size };
  config.point_pairs = pairs.map(pair => {
    const [x, y] = imageToRink(pair.image_px, config);
    return { ...pair, error_m: Math.hypot(x - pair.rink_m[0], y - pair.rink_m[1]), inlier: true };
  });
  config.reprojection_rms_m = Math.sqrt(config.point_pairs.reduce((sum, pair) => sum + pair.error_m! ** 2, 0) / pairs.length);
  return config;
}

export function rinkLandmarks(rink: RinkTemplate): Record<string, Point> {
  const { y, goalX, blueX, endX, neutralX, boardY, goalHalfWidth } = rinkGeometry(rink);
  const landmarks: Record<string, Point> = { centre_dot: [0, 0], centre_line_near: [0, -y], centre_line_far: [0, y] };
  for (const [end, sx] of [['left', -1], ['right', 1]] as const) {
    for (const [side, sy] of [['near', -1], ['far', 1]] as const) {
      for (const [mark, x, y] of [
        ['blue_line', blueX, boardY(blueX)], ['goal_line', goalX, boardY(goalX)], ['goal_post', goalX, goalHalfWidth],
        ['end_dot', endX, rink.end_faceoff.from_centre_y_m], ['neutral_dot', neutralX, rink.neutral_faceoff.from_centre_y_m],
      ] as const) landmarks[`${end}_${mark}_${side}`] = [sx * x, sy * y];
    }
  }
  return landmarks;
}

function arc(cx: number, cy: number, r: number, start: number, size: number): Point[] {
  return Array.from({ length: 33 }, (_, i) => {
    const angle = (start + i * size / 32) * Math.PI / 180;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  });
}

export function rinkPaths(rink: RinkTemplate) {
  const { x, y, r } = rinkGeometry(rink);
  const landmarks = rinkLandmarks(rink);
  const outline = arc(x-r, y-r, r, 0, 90).concat(arc(r-x, y-r, r, 90, 90), arc(r-x, r-y, r, 180, 90), arc(x-r, r-y, r, 270, 90));
  const lines = ['centre_line', 'left_blue_line', 'right_blue_line', 'left_goal_line', 'right_goal_line'].map(name => {
    const [x, near] = landmarks[`${name}_near`];
    const [, far] = landmarks[`${name}_far`];
    return { color: name.includes('blue') ? '#558fff' : '#ff5776',
      points: Array.from({ length: 33 }, (_, i): Point => [x, near + (far - near) * i / 32]) };
  });
  const circles = Object.entries(landmarks).filter(([name]) => name === 'centre_dot' || name.includes('_end_dot_'))
    .map(([name, [cx, cy]]) => ({ color: name === 'centre_dot' ? '#558fff' : '#ff5776', points: arc(cx, cy, rink.faceoff_circle_radius_m, 0, 360) }));
  return [{ color: '#70e4d0', points: [...outline, outline[0]] }, ...lines, ...circles];
}
