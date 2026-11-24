import { ghostKey, interpolate } from './clip'
import type { Ghost, Keyframe, Point, PositionSample, Role, TeachingClip, Team } from './types'

const unlinkedGhostKeys = new WeakMap<Ghost, string>()
let nextGhostKey = 0

export interface Player {
  key: string
  trackId: number | null
  manualId?: string
  team: Team
  role: Role
  point: Point
  caption: string
  hidden: boolean
}

export interface GhostMarker {
  key: string
  team: Team
  role: Role
  point: Point
  original?: Point
  caption?: string
}

export function boardPlayers(frame: readonly PositionSample[], clip: TeachingClip): Player[] {
  const hidden = new Set(clip.hidden_track_ids)
  return [
    ...frame.map((p): Player => ({
      key: `track:${p.track_id}`, trackId: p.track_id, team: p.team, role: p.role,
      point: [p.x_m, p.y_m], caption: String(p.track_id), hidden: hidden.has(p.track_id) || !p.on_ice,
    })),
    ...clip.added_players_json.map((p, i): Player => ({
      key: `manual:${p.id}`, manualId: p.id, trackId: null, team: p.team, role: p.role,
      point: [p.x_m, p.y_m], caption: String(p.team === 'none' ? 'R' : p.team) + (i + 1),
      hidden: p.hidden ?? false,
    })),
  ]
}

export function ghostMarkerKey(ghost: Ghost) {
  const existing = ghostKey(ghost) ?? unlinkedGhostKeys.get(ghost)
  if (existing) return existing
  const key = `unlinked:${nextGhostKey++}`
  unlinkedGhostKeys.set(ghost, key)
  return key
}

export function withGhostKeyframes(ghost: Ghost, keyframes: Keyframe[]): Ghost {
  const updated = { ...ghost, keyframes }
  if (!ghostKey(ghost)) unlinkedGhostKeys.set(updated, ghostMarkerKey(ghost))
  return updated
}

export function ghostMarkers(clip: TeachingClip, players: Player[], time: number): GhostMarker[] {
  return clip.ghosts_json.flatMap(ghost => {
    const key = ghostMarkerKey(ghost)
    const source = players.find(player => player.key === key)
    const point = interpolate(ghost.keyframes, time)
    if (!point || source?.hidden || (ghost.track_id !== null && clip.hidden_track_ids.includes(ghost.track_id))) return []
    return [{
      key, team: ghost.team, role: source?.role ?? 'player', point,
      original: source?.point, caption: source?.caption,
    }]
  })
}

export const teamColor = (team: Team, role?: Role) =>
  role === 'referee' || team === 'none' ? '#505d72' : team === 'A' ? '#174fc8' : '#bc3251'
