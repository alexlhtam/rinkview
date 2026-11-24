import Ajv2020 from 'ajv/dist/2020.js';
import positionsSchema from '../../../shared/schemas/positions.schema.json';
import summarySchema from '../../../shared/schemas/summary.schema.json';

export type Team = 'A' | 'B' | 'none';
export type PlayingTeam = Exclude<Team, 'none'>;
export type Role = 'player' | 'goalie' | 'referee';

export interface Position {
  t: number;
  frame: number;
  track_id: number;
  role: Role;
  team: Team;
  x_m: number;
  y_m: number;
  vx: number;
  vy: number;
  conf: number;
  on_ice: boolean;
  interpolated: boolean;
}

export interface Heatmap {
  x_min_m: number;
  y_min_m: number;
  cell_size_m: number;
  grid: number[][];
}

export interface Period {
  period: number;
  zone_time: Record<PlayingTeam, { defensive_s: number; neutral_s: number; offensive_s: number }>;
  heatmaps: Record<PlayingTeam, Heatmap>;
  track_counts: Record<Team, number>;
}

export interface Summary {
  periods: Period[];
  processing_stats: { source_frames: number; processed_frames: number; elapsed_s: number };
  drift_warnings: { start_s: number; end_s: number; message: string }[];
}

export interface RinkTemplate {
  id: string;
  length_m: number;
  width_m: number;
  corner_radius_m: number;
  goal_line_from_end_m: number;
  blue_line_from_centre_m: number;
  faceoff_circle_radius_m: number;
  end_faceoff: { from_goal_line_m: number; from_centre_y_m: number };
  neutral_faceoff: { from_blue_line_m: number; from_centre_y_m: number };
  goal_width_m?: number;
  trapezoid?: { goal_line_half_width_m: number; end_boards_half_width_m: number };
}

const ajv = new Ajv2020();
export const isPositions = ajv.compile<Position[]>(positionsSchema);
export const isSummary = ajv.compile<Summary>(summarySchema);

const positive = { type: 'number', exclusiveMinimum: 0 };
function fields(...keys: string[]) {
  return {
    type: 'object',
    required: keys,
    properties: Object.fromEntries(keys.map(key => [key, positive])),
  };
}
const dimensions = fields('length_m', 'width_m', 'corner_radius_m', 'goal_line_from_end_m',
  'blue_line_from_centre_m', 'faceoff_circle_radius_m');
const templateShape = ajv.compile<RinkTemplate>({
  type: 'object',
  required: ['id', ...dimensions.required, 'end_faceoff', 'neutral_faceoff'],
  properties: {
    ...dimensions.properties,
    id: { type: 'string', minLength: 1 },
    goal_width_m: positive,
    end_faceoff: fields('from_goal_line_m', 'from_centre_y_m'),
    neutral_faceoff: fields('from_blue_line_m', 'from_centre_y_m'),
    trapezoid: fields('goal_line_half_width_m', 'end_boards_half_width_m'),
  },
});

export function isRinkTemplate(value: unknown): value is RinkTemplate {
  if (!templateShape(value)) return false;
  const { length_m, width_m, corner_radius_m, goal_line_from_end_m, blue_line_from_centre_m } = value;
  return corner_radius_m <= Math.min(length_m, width_m) / 2
    && blue_line_from_centre_m < length_m / 2 - goal_line_from_end_m;
}
