import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import schema from '../../../shared/schemas/teaching-clip.schema.json'
import { clamp } from './geometry'
import type { Ghost, Keyframe, Point, TeachingClip } from './types'

const ajv = new Ajv2020({ allErrors: true })
addFormats(ajv, ['date-time'])
const validate = ajv.compile<TeachingClip>(schema)

export function newId() {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

export function createClip(start = 0): TeachingClip {
  const now = new Date().toISOString()
  return {
    id: newId(), start_t: start, end_t: start + 4, title: '', notes: '', tags: [],
    annotations_json: [], ghosts_json: [], hidden_track_ids: [], added_players_json: [],
    created_at: now, updated_at: now,
  }
}

export function parseClip(input: string): TeachingClip {
  const clip: unknown = JSON.parse(input)
  if (!validate(clip)) {
    const issue = validate.errors?.[0]
    throw new Error(`Invalid Teaching Clip: ${issue?.instancePath || '/'} ${issue?.message ?? ''}`)
  }
  if (clip.end_t < clip.start_t) throw new Error('Clip end must be at or after its start.')
  const inRange = (t: number) => t >= clip.start_t && t <= clip.end_t
  if (clip.annotations_json.some(a => !inRange(a.t_from) || !inRange(a.t_to) || a.t_from > a.t_to)
    || clip.ghosts_json.some(g => g.keyframes.some(k => !inRange(k.t)))) {
    throw new Error('Annotation times and ghost keyframes must be inside the clip.')
  }
  if (new Set(clip.added_players_json.map(player => player.id)).size !== clip.added_players_json.length
    || new Set(clip.annotations_json.map(annotation => annotation.id)).size !== clip.annotations_json.length) {
    throw new Error('Player and annotation IDs must be unique.')
  }
  const playerIds = new Set(clip.added_players_json.map(player => player.id))
  const linked = new Set<string>()
  for (const ghost of clip.ghosts_json) {
    const key = ghostKey(ghost)
    if (key && (linked.has(key) || (ghost.player_id && !playerIds.has(ghost.player_id)))) {
      throw new Error('A ghost must link to a unique source player.')
    }
    if (key) linked.add(key)
    if (new Set(ghost.keyframes.map(k => k.t)).size !== ghost.keyframes.length) {
      throw new Error('A ghost cannot have two keyframes at the same time.')
    }
  }
  return {
    ...clip,
    ghosts_json: clip.ghosts_json.map(ghost => ({
      ...ghost, keyframes: [...ghost.keyframes].sort((a, b) => a.t - b.t),
    })),
  }
}

export function serializeClip(clip: TeachingClip) {
  return JSON.stringify(clip, null, 2) + '\n'
}

export function ghostKey(ghost: Ghost) {
  if (ghost.track_id !== null) return `track:${ghost.track_id}`
  return ghost.player_id ? `manual:${ghost.player_id}` : undefined
}

export function interpolate(keyframes: readonly Keyframe[], time: number): Point | undefined {
  if (!keyframes.length) return undefined
  const right = keyframes.findIndex(frame => frame.t >= time)
  const to = keyframes[right === -1 ? keyframes.length - 1 : right]
  if (right <= 0) return [to.x_m, to.y_m]
  const from = keyframes[right - 1]
  const fraction = clamp((time - from.t) / (to.t - from.t), 0, 1)
  return [from.x_m + (to.x_m - from.x_m) * fraction, from.y_m + (to.y_m - from.y_m) * fraction]
}

export function setKeyframe(keyframes: readonly Keyframe[], next: Keyframe): Keyframe[] {
  return [...keyframes.filter(frame => frame.t !== next.t), next].sort((a, b) => a.t - b.t)
}
