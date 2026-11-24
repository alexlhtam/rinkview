import type { Point, RinkTemplate } from './types'

export const PADDING = 1.6
export const distance = ([ax, ay]: Point, [bx, by]: Point) => Math.hypot(ax - bx, ay - by)
export const toSvg = ([x, y]: Point): Point => [x, -y]
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

export function rinkGeometry(rink: RinkTemplate) {
  const x = rink.length_m / 2
  const y = rink.width_m / 2
  const radius = Math.min(rink.corner_radius_m, x, y)
  const goalX = x - rink.goal_line_from_end_m
  const blueX = rink.blue_line_from_centre_m
  const endFaceoffX = goalX - rink.end_faceoff.from_goal_line_m
  const neutralFaceoffX = blueX - rink.neutral_faceoff.from_blue_line_m
  const width = (x + PADDING) * 2
  const height = (y + PADDING) * 2
  return { x, y, radius, goalX, blueX, endFaceoffX, neutralFaceoffX, width, height }
}

export function clampToIce(point: Point, rink: RinkTemplate): Point {
  const { x, y, radius } = rinkGeometry(rink)
  const bounded: Point = [clamp(point[0], -x, x), clamp(point[1], -y, y)]
  const cx = x - radius
  const cy = y - radius
  const dx = Math.abs(bounded[0]) - cx
  const dy = Math.abs(bounded[1]) - cy
  if (dx <= 0 || dy <= 0 || Math.hypot(dx, dy) <= radius) return bounded
  const factor = radius / Math.hypot(dx, dy)
  return [Math.sign(bounded[0]) * (cx + dx * factor), Math.sign(bounded[1]) * (cy + dy * factor)]
}

export function pointInView(
  client: Point,
  rect: { left: number; top: number; width: number; height: number },
  rink: RinkTemplate,
): Point {
  const { width, height } = rinkGeometry(rink)
  const scale = Math.min(rect.width / width, rect.height / height)
  return [
    (client[0] - rect.left - rect.width / 2) / scale,
    -(client[1] - rect.top - rect.height / 2) / scale,
  ]
}

export function rectangle(a: Point, b: Point): Point[] {
  return [a, [b[0], a[1]], b, [a[0], b[1]]]
}
