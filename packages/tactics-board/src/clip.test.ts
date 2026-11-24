import { describe, expect, it } from 'vitest'
import { exampleClip } from '../demo/example'
import { createClip, interpolate, parseClip, serializeClip, setKeyframe } from './clip'
import { historyOf, push, redo, undo } from './history'
import { boardPlayers, ghostMarkerKey, ghostMarkers } from './players'
import type { PositionSample } from './types'

describe('Teaching Clip JSON', () => {
  it('round-trips annotations, metadata, tracked and manual ghosts, and visibility', () => {
    const clip = exampleClip()
    clip.video_id = 'v1'
    clip.hidden_track_ids = [7]
    clip.added_players_json[1].hidden = true
    clip.ghosts_json = [
      { track_id: null, player_id: 'right-defence', team: 'A', keyframes: [{ t: 0, x_m: 5, y_m: 2 }, { t: 4, x_m: 7, y_m: 8 }] },
      { track_id: 7, team: 'B', keyframes: [{ t: 3, x_m: 18, y_m: 5 }] },
      { track_id: null, team: 'none', keyframes: [{ t: 0, x_m: -1, y_m: 1 }] },
    ]
    const json = serializeClip(clip)
    expect(json).toContain('"annotations_json"')
    expect(json).toContain('"ghosts_json"')
    expect(parseClip(json)).toEqual(clip)
  })

  it('accepts a standalone freeze frame with no video and a zero-length range', () => {
    const clip = { ...createClip(), end_t: 0 }
    expect(parseClip(serializeClip(clip))).toEqual(clip)
  })

  it('canonicalizes unsorted keyframes and rejects out-of-range or duplicate times', () => {
    const clip = createClip(12.3)
    const starting = { t: 12.3, x_m: 2, y_m: 1 }
    const ending = { t: 16.3, x_m: 4, y_m: 5 }
    const keyframes = [ending, starting]
    clip.ghosts_json.push({ track_id: 12, team: 'B', keyframes })
    expect(parseClip(serializeClip(clip)).ghosts_json[0].keyframes).toEqual([starting, ending])
    keyframes.push({ ...starting })
    expect(() => parseClip(serializeClip(clip))).toThrow('two keyframes')
    keyframes[2] = { ...starting, t: 0 }
    expect(() => parseClip(serializeClip(clip))).toThrow('inside the clip')
  })

  it('rejects structurally invalid annotations and dangling manual ghost links', () => {
    const clip = exampleClip()
    clip.annotations_json[2].points_m.pop()
    expect(() => parseClip(serializeClip(clip))).toThrow('Invalid Teaching Clip:')
    clip.annotations_json = []
    clip.ghosts_json = [{ track_id: null, player_id: 'missing', team: 'A', keyframes: [{ t: 0, x_m: 4, y_m: 4 }] }]
    expect(() => parseClip(serializeClip(clip))).toThrow('source player')
  })

  it('gives each imported ghost without an original a distinct, selectable marker', () => {
    const clip = createClip()
    const keyframes = [{ t: 0, x_m: 2, y_m: 4 }]
    clip.ghosts_json = [
      { track_id: null, team: 'A', keyframes },
      { track_id: null, team: 'A', keyframes },
      { track_id: 10, team: 'B', keyframes },
    ]
    const loaded = parseClip(serializeClip(clip))
    const markers = ghostMarkers(loaded, [], 0)
    expect(markers.map(marker => marker.key)).toEqual(['unlinked:0', 'unlinked:1', 'track:10'])
    expect(markers.every(marker => marker.original === undefined)).toBe(true)
    expect(loaded.ghosts_json.find((ghost, i) => ghostMarkerKey(ghost, i) === markers[1].key))
      .toBe(loaded.ghosts_json[1])
  })
})

describe('ghost animation', () => {
  it('interpolates both coordinates and holds before the first and after the last key', () => {
    const frames = [{ t: 2, x_m: 2, y_m: -4 }, { t: 6, x_m: 10, y_m: 4 }]
    expect(interpolate(frames, 3)).toEqual([4, -2])
    expect(interpolate(frames, 6)).toEqual([10, 4])
    expect(interpolate(frames, 0)).toEqual([2, -4])
    expect(interpolate(frames, 9)).toEqual([10, 4])
    expect(interpolate([], 1)).toBeUndefined()
  })

  it('inserts and replaces keys in time order without mutating history', () => {
    const first = { t: 0, x_m: 0, y_m: 0 }
    const last = { t: 3, x_m: 3, y_m: 3 }
    const revised = { ...last, x_m: 4 }
    const frames = setKeyframe([], last)
    expect(setKeyframe(setKeyframe(frames, first), revised)).toEqual([first, revised])
    expect(frames).toEqual([last])
  })

  it('replaces an imported key at its exact time without modifying a nearby key', () => {
    const clip = createClip()
    const first = { t: 1.2345, x_m: 2, y_m: 4 }
    const second = { t: 1.235, x_m: 3, y_m: 6 }
    clip.ghosts_json = [{ track_id: 10, team: 'B', keyframes: [first, second] }]
    const [{ keyframes }] = parseClip(serializeClip(clip)).ghosts_json
    const revised = { ...keyframes[0], x_m: 5 }
    expect(setKeyframe(keyframes, revised)).toEqual([revised, second])
  })

  it('resolves tracked ghosts against the frozen source, and hides both when the source is hidden', () => {
    const source: PositionSample = {
      t: 18, frame: 180, track_id: 10, role: 'goalie', team: 'B',
      x_m: 10, y_m: -4, vx: 0, vy: 0, conf: .9, on_ice: true, interpolated: false,
    }
    const clip = createClip(source.t)
    clip.ghosts_json = [{ track_id: 10, team: 'B', keyframes: [
      { t: 18, x_m: 4, y_m: 5 }, { t: 22, x_m: 6, y_m: 7 },
    ] }]
    expect(ghostMarkers(clip, boardPlayers([source], clip), 20)).toMatchObject([
      { key: 'track:10', role: 'goalie', point: [5, 6], original: [10, -4] },
    ])
    clip.hidden_track_ids.push(10)
    expect(ghostMarkers(clip, boardPlayers([source], clip), 20)).toEqual([])
  })
})

it('undoes and redoes board edits, and discards redo history after a new edit', () => {
  const one = historyOf('blank')
  const two = push(one, 'player')
  const three = push(two, 'correction')
  expect(undo(three).current).toBe('player')
  expect(redo(undo(three))).toEqual(three)
  expect(redo(push(undo(three), 'arrow')).current).toBe('arrow')
})
