import { describe, expect, it } from 'vitest'
import rink from '../../../shared/rink_templates/custom-uk-56x26.json'
import { clampToIce, distance, pointInView, rectangle, rinkGeometry, toSvg } from './geometry'
import { appendPoint, canFinishZone } from './tools'

describe('rink coordinates', () => {
  it('derives blue lines and faceoff spots from the template', () => {
    expect(rinkGeometry(rink)).toMatchObject({
      x: 28, y: 13, radius: 8.5, goalX: 24, blueX: 8.5, endFaceoffX: 18, neutralFaceoffX: 7,
    })
  })

  it('unprojects screen points on a centred, letterboxed view with +y toward the far boards', () => {
    const { width, height } = rinkGeometry(rink)
    const rect = { left: 20, top: 10, width: width * 10, height: height * 10 + 80 }
    const middleX = rect.left + rect.width / 2
    const middleY = rect.top + rect.height / 2
    expect(pointInView([middleX + 70, middleY - 40], rect, rink)).toEqual([7, 4])
    expect(toSvg([7, 4])).toEqual([7, -4])
  })

  it('clamps to the rounded boards and leaves interior points alone', () => {
    const [x, y] = clampToIce([35, 19], rink)
    expect(Math.hypot(x - 19.5, y - 4.5)).toBeCloseTo(8.5)
    expect(clampToIce([-35, -19], rink)).toEqual([-x, -y])
    expect(clampToIce([4, -7], rink)).toEqual([4, -7])
  })

  it('keeps zone vertices in drawing order and only closes a non-collinear polygon', () => {
    expect(rectangle([5, 6], [-2, -3])).toEqual([[5, 6], [-2, 6], [-2, -3], [5, -3]])
    const points: [number, number][] = [[0, 0], [3, 0], [6, 0]]
    expect(appendPoint(points, [3.04, 0])).toBe(points)
    expect(canFinishZone(points)).toBe(false)
    expect(canFinishZone(appendPoint(points, [1, 1]))).toBe(true)
    expect(distance([-1, 2], [2, -2])).toBe(5)
  })
})
