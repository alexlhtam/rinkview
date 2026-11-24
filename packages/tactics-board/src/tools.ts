import type { Annotation, AnnotationKind, Point, TeachingClip } from './types'
import { distance, rectangle } from './geometry'

export const tools = [
  ['select', 'Move / select', 'Move a board player, or drag a tracked player to correct it.', 'move'],
  ['arrow', 'Skate arrow', 'Drag from the start to the end of a skating route.', 'arrow'],
  ['pass', 'Pass arrow', 'Drag to draw a dashed passing route.', 'pass'],
  ['line', 'Line', 'Drag to draw a line.', 'line'],
  ['pen', 'Freehand', 'Draw freely on the ice.', 'pen'],
  ['rectangle', 'Rectangle zone', 'Drag across the area to shade.', 'rectangle'],
  ['polygon', 'Polygon zone', 'Click the corners, then choose Finish zone or press Enter.', 'polygon'],
  ['label', 'Text label', 'Enter label text, then click to place it.', 'text'],
  ['spotlight', 'Spotlight', 'Click a player to mark their position.', 'spotlight'],
  ['measure', 'Measure', 'Drag or click two points. Endpoints snap to visible players.', 'measure'],
  ['player', 'Add player', 'Choose a team and role, then click to add a player.', 'player'],
  ['ghost', 'Ghost correction', 'Drag a player or ghost. Scrub and drag again to add a keyframe.', 'ghost'],
] as const

export type Tool = typeof tools[number][0]
export type DragTool = 'arrow' | 'pass' | 'line' | 'pen' | 'rectangle' | 'measure'

export function isDragTool(tool: Tool): tool is DragTool {
  return tool === 'arrow' || tool === 'pass' || tool === 'line'
    || tool === 'pen' || tool === 'rectangle' || tool === 'measure'
}

export function annotationAt(
  id: string, clip: TeachingClip, tool: AnnotationKind | 'rectangle' | 'polygon',
  points: Point[], color: string, text?: string,
): Annotation {
  const shape = tool === 'rectangle' || tool === 'polygon' ? tool : undefined
  return {
    id, kind: shape ? 'zone' : tool as AnnotationKind, t_from: clip.start_t, t_to: clip.end_t,
    points_m: tool === 'rectangle' ? rectangle(points[0], points[1]) : points,
    style: { color, ...(shape ? { shape } : {}), ...(text ? { text } : {}) },
  }
}

export function canFinishZone(points: Point[]) {
  if (points.length < 3) return false
  const [origin, next, ...remaining] = points
  return remaining.some(point => Math.abs(
    (next[0] - origin[0]) * (point[1] - origin[1]) - (next[1] - origin[1]) * (point[0] - origin[0]),
  ) > .01)
}

export function appendPoint(points: Point[], point: Point) {
  return points.some(existing => distance(existing, point) < .14) ? points : [...points, point]
}
