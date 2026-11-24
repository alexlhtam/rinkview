export type Point = [x: number, y: number]
export type Team = 'A' | 'B' | 'none'
export type Role = 'player' | 'goalie' | 'referee'

export interface RinkTemplate {
  id: string
  length_m: number
  width_m: number
  corner_radius_m: number
  goal_line_from_end_m: number
  blue_line_from_centre_m: number
  faceoff_circle_radius_m: number
  end_faceoff: { from_goal_line_m: number; from_centre_y_m: number }
  neutral_faceoff: { from_blue_line_m: number; from_centre_y_m: number }
  goal_width_m?: number
  trapezoid?: { goal_line_half_width_m: number; end_boards_half_width_m: number }
}

export interface PositionSample {
  t: number
  frame: number
  track_id: number
  role: Role
  team: Team
  x_m: number
  y_m: number
  vx: number
  vy: number
  conf: number
  on_ice: boolean
  interpolated: boolean
}

export interface AddedPlayer {
  id: string
  team: Team
  role: Role
  x_m: number
  y_m: number
  hidden?: boolean
}

export type AnnotationKind = 'arrow' | 'pass' | 'line' | 'pen' | 'zone' | 'label' | 'spotlight' | 'measure'

export interface Annotation {
  id: string
  kind: AnnotationKind
  t_from: number
  t_to: number
  points_m: Point[]
  style: {
    color?: string
    text?: string
    shape?: 'rectangle' | 'polygon'
  }
}

export interface Keyframe {
  t: number
  x_m: number
  y_m: number
}

export interface Ghost {
  track_id: number | null
  team: Team
  keyframes: Keyframe[]
  player_id?: string
}

export interface TeachingClip {
  id: string
  video_id?: string | null
  start_t: number
  end_t: number
  title: string
  notes: string
  tags: string[]
  annotations_json: Annotation[]
  ghosts_json: Ghost[]
  hidden_track_ids: number[]
  added_players_json: AddedPlayer[]
  created_at: string
  updated_at: string
}

export interface TacticsBoardProps {
  rinkTemplate: RinkTemplate
  initialPlayers?: readonly PositionSample[]
  initialClip?: TeachingClip
  onChange?: (clip: TeachingClip) => void
}
