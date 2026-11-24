import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { BoardSurface, INK } from './BoardSurface'
import { createClip, ghostKey, newId, parseClip, serializeClip, setKeyframe } from './clip'
import { download, rinkPng } from './export'
import { clamp, clampToIce, distance, pointInView } from './geometry'
import { historyOf, push, redo, undo } from './history'
import { Icon } from './Icons'
import { boardPlayers, ghostMarkerKey, ghostMarkers, teamColor } from './players'
import type { GhostMarker, Player } from './players'
import { annotationAt, appendPoint, canFinishZone, isDragTool, tools } from './tools'
import type { DragTool, Tool } from './tools'
import type { Annotation, Ghost, Point, Role, TacticsBoardProps, TeachingClip, Team } from './types'

const noPlayers = [] as const
const colors = [
  ['Blue', INK], ['Rose', '#ab284c'], ['Green', '#08785d'], ['Gold', '#94600b'], ['Ink', '#20293d'],
] as const
type Layers = { players: boolean; ghosts: boolean; annotations: boolean }
type Stroke = { tool: DragTool; points: Point[] }
type Movable = Player | GhostMarker
type Drag = { tool: 'move' | 'ghost'; player: Movable; start: Point; point: Point }
type Draft = Stroke | Drag

export function TacticsBoard({ rinkTemplate, initialPlayers = noPlayers, initialClip, onChange }: TacticsBoardProps) {
  const [history, setHistory] = useState(() =>
    historyOf(initialClip ?? createClip(initialPlayers[0]?.t ?? 0)))
  const clip = history.current
  const committed = useRef(clip)
  const [time, setTime] = useState(clip.start_t)
  const [playing, setPlaying] = useState(false)
  const playhead = clamp(time, clip.start_t, clip.end_t)
  const [tool, setTool] = useState<Tool>('select')
  const [layers, setLayers] = useState<Layers>({ players: true, ghosts: true, annotations: true })
  const [color, setColor] = useState<string>(INK)
  const [text, setText] = useState('')
  const [team, setTeam] = useState<Team>('A')
  const [role, setRole] = useState<Role>('player')
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraftState] = useState<Draft | null>(null)
  const draftRef = useRef<Draft | null>(null)
  const [polygon, setPolygon] = useState<Point[]>([])
  const [measureAnchor, setMeasureAnchor] = useState<Point>()
  const [presenting, setPresenting] = useState(false)
  const [notice, setNotice] = useState('')
  const root = useRef<HTMLElement>(null)
  const surface = useRef<SVGSVGElement>(null)
  const rink = useRef<SVGSVGElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const playerList = boardPlayers(initialPlayers, clip)
  const selectedPlayer = playerList.find(player => player.key === selected)
  const selectedGhost = clip.ghosts_json.find((ghost, index) => ghostMarkerKey(ghost, index) === selected)
  const selectedMarker = selectedPlayer ?? selectedGhost
  const shownGhosts = layers.ghosts ? ghostMarkers(clip, playerList, playhead) : []
  const shownPlayers = layers.players ? playerList.filter(player => !player.hidden) : []
  const annotations = layers.annotations
    ? clip.annotations_json.filter(a => a.t_from <= playhead && playhead <= a.t_to) : []
  const dragging = draft && 'player' in draft ? draft : undefined

  useEffect(() => {
    if (committed.current === clip) return
    committed.current = clip
    onChange?.(clip)
  }, [clip, onChange])

  useEffect(() => {
    if (!playing) return
    let frame: number
    const origin = performance.now()
    const advance = (now: number) => {
      const next = Math.min(clip.end_t, time + (now - origin) / 1000)
      if (next >= clip.end_t) {
        setTime(clip.end_t)
        setPlaying(false)
      } else {
        updatePlayhead(next)
        frame = requestAnimationFrame(advance)
      }
    }
    frame = requestAnimationFrame(advance)
    return () => cancelAnimationFrame(frame)
  }, [playing, clip.end_t, time])

  const [animatedTime, updatePlayhead] = useState(clip.start_t)
  const currentTime = playing ? animatedTime : playhead

  useEffect(() => {
    let wasFullscreen = false
    const sync = () => {
      if (document.fullscreenElement === root.current) wasFullscreen = true
      else if (wasFullscreen) {
        wasFullscreen = false
        setPresenting(false)
      }
    }
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  function edit(update: (current: TeachingClip) => TeachingClip) {
    const now = new Date().toISOString()
    setHistory(previous => {
      const next = update(previous.current)
      return next === previous.current ? previous : push(previous, { ...next, updated_at: now })
    })
  }

  function setDraft(next: Draft | null) {
    draftRef.current = next
    setDraftState(next)
  }

  function clearDraft() {
    setDraft(null)
    setPolygon([])
    setMeasureAnchor(undefined)
  }

  function chooseTool(next: Tool) {
    clearDraft()
    setNotice('')
    setTool(next)
    const layer = next === 'ghost' ? 'ghosts' : next === 'player' ? 'players'
      : next === 'select' ? undefined : 'annotations'
    if (layer) setLayers(previous => ({ ...previous, [layer]: true }))
  }

  function seek(next: number) {
    setTime(next)
    setPlaying(false)
  }

  function play() {
    if (playing) return seek(currentTime)
    if (clip.end_t === clip.start_t) return
    const start = playhead >= clip.end_t ? clip.start_t : playhead
    clearDraft()
    setTime(start)
    updatePlayhead(start)
    setPlaying(true)
  }

  function visitHistory(action: typeof undo<TeachingClip>) {
    clearDraft()
    if (selectedGhost && !ghostKey(selectedGhost)) setSelected(null)
    seek(currentTime)
    setHistory(action)
  }

  function addAnnotation(kind: Annotation['kind'] | 'rectangle' | 'polygon', points: Point[], label?: string) {
    const annotation = annotationAt(newId(), clip, kind, points, color, label)
    edit(previous => ({ ...previous, annotations_json: [...previous.annotations_json, annotation] }))
  }

  function finishZone() {
    if (!canFinishZone(polygon)) return
    addAnnotation('polygon', polygon)
    setPolygon([])
  }

  function movePlayer(player: Movable, point: Point, correction: boolean) {
    const source = 'trackId' in player ? player : undefined
    if (!correction && source?.manualId) {
      edit(previous => ({
        ...previous,
        added_players_json: previous.added_players_json.map(p => p.id === source.manualId
          ? { ...p, x_m: point[0], y_m: point[1] } : p),
      }))
      return
    }
    const t = playhead
    const keyframe = { t, x_m: point[0], y_m: point[1] }
    edit(previous => {
      const existing = previous.ghosts_json.find((ghost, index) => ghostMarkerKey(ghost, index) === player.key)
      const base = existing ?? (source && {
        track_id: source.trackId, team: source.team, keyframes: [],
        ...(source.manualId ? { player_id: source.manualId } : {}),
      })
      if (!base) return previous
      const frames = !existing && t > previous.start_t
        ? [{ t: previous.start_t, x_m: player.point[0], y_m: player.point[1] }] : base.keyframes
      const next = { ...base, keyframes: setKeyframe(frames, keyframe) }
      return {
        ...previous, ghosts_json: existing
          ? previous.ghosts_json.map(g => g === existing ? next : g)
          : [...previous.ghosts_json, next],
      }
    })
    setLayers(previous => ({ ...previous, ghosts: true }))
  }

  function toggleHidden(player: Player) {
    edit(previous => player.trackId !== null ? {
      ...previous,
      hidden_track_ids: previous.hidden_track_ids.includes(player.trackId)
        ? previous.hidden_track_ids.filter(id => id !== player.trackId)
        : [...previous.hidden_track_ids, player.trackId],
    } : {
      ...previous,
      added_players_json: previous.added_players_json.map(p =>
        p.id === player.manualId ? { ...p, hidden: !p.hidden } : p),
    })
  }

  function removeKeyframe(ghost: Ghost, t: number) {
    if (ghost.keyframes.length === 1 && !selectedPlayer) setSelected(null)
    edit(previous => ({
      ...previous,
      ghosts_json: previous.ghosts_json.flatMap(g => {
        if (g !== ghost) return [g]
        const keyframes = g.keyframes.filter(frame => frame.t !== t)
        return keyframes.length ? [{ ...g, keyframes }] : []
      }),
    }))
  }

  function pointerPoint(event: PointerEvent<SVGSVGElement>) {
    return clampToIce(pointInView([event.clientX, event.clientY],
      event.currentTarget.getBoundingClientRect(), rinkTemplate), rinkTemplate)
  }

  function hit(point: Point) {
    const targets = [
      ...shownGhosts.map(ghost => {
        const player = playerList.find(p => p.key === ghost.key)
        return { point: ghost.point, player: player ?? ghost, ghost: true }
      }),
      ...shownPlayers.map(player => ({ point: player.point, player, ghost: false })),
    ]
    const radius = 1.25
    return targets.reduce<typeof targets[number] | undefined>((nearest, target) =>
      distance(point, target.point) < (nearest ? distance(point, nearest.point) : radius)
        ? target : nearest, undefined)
  }

  function startPointer(event: PointerEvent<SVGSVGElement>) {
    if (presenting || playing || !event.isPrimary || event.button !== 0) return
    setNotice('')
    const point = pointerPoint(event)
    const target = hit(point)
    if (tool === 'label') {
      if (text.trim()) addAnnotation('label', [target?.point ?? point], text.trim())
      else setNotice('Enter label text before placing it.')
    } else if (tool === 'spotlight') {
      if (target) addAnnotation('spotlight', [target.point])
      else setNotice('Click a visible player or ghost to spotlight.')
    } else if (tool === 'player') {
      const player = { id: newId(), x_m: point[0], y_m: point[1], team: role === 'referee' ? 'none' as const : team, role }
      edit(previous => ({ ...previous, added_players_json: [...previous.added_players_json, player] }))
      setSelected(`manual:${player.id}`)
    } else if (tool === 'polygon') {
      setPolygon(previous => appendPoint(previous, point))
    } else if (tool === 'select' || tool === 'ghost') {
      setSelected(target?.player?.key ?? null)
      if (target?.player) {
        setDraft({ tool: tool === 'ghost' || target.ghost ? 'ghost' : 'move',
          player: target.player, start: point, point: target.point })
        event.currentTarget.setPointerCapture(event.pointerId)
      }
    } else if (isDragTool(tool)) {
      const start = tool === 'measure' ? measureAnchor ?? target?.point ?? point : point
      setDraft({ tool, points: [start, start] })
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }

  function movePointer(event: PointerEvent<SVGSVGElement>) {
    const current = draftRef.current
    if (!current || !event.isPrimary) return
    const point = pointerPoint(event)
    if ('player' in current) setDraft({ ...current, point })
    else if (current.tool === 'pen') {
      if (distance(point, current.points.at(-1)!) > .08) setDraft({ ...current, points: [...current.points, point] })
    } else setDraft({ ...current, points: [current.points[0], current.tool === 'measure' ? hit(point)?.point ?? point : point] })
  }

  function endPointer(event: PointerEvent<SVGSVGElement>) {
    const current = draftRef.current
    if (!current || !event.isPrimary) return
    const point = pointerPoint(event)
    setDraft(null)
    if ('player' in current) {
      if (distance(point, current.start) > .16) movePlayer(current.player, point, current.tool === 'ghost')
      return
    }
    const from = current.points[0]
    const to = current.tool === 'measure' ? hit(point)?.point ?? point : point
    if (current.tool === 'measure') {
      if (distance(from, to) > .12) {
        addAnnotation('measure', [from, to])
        setMeasureAnchor(undefined)
      } else setMeasureAnchor(to)
    } else if (current.tool === 'pen') {
      const path = [...current.points, to]
      if (path.some(p => distance(p, from) > .12)) addAnnotation('pen', path)
    } else if (current.tool === 'rectangle'
      ? Math.abs(from[0] - to[0]) > .12 && Math.abs(from[1] - to[1]) > .12
      : distance(from, to) > .12) {
      addAnnotation(current.tool, [from, to])
    }
  }

  async function present() {
    clearDraft()
    if (presenting) {
      setPresenting(false)
      if (document.fullscreenElement === root.current) await document.exitFullscreen()
    } else {
      setPresenting(true)
      try { await root.current?.requestFullscreen?.() } catch { /* CSS fallback */ }
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      if (presenting) void present()
      else clearDraft()
      return
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      || event.target instanceof HTMLSelectElement || presenting) return
    if (event.key === 'Enter' && tool === 'polygon' && event.target === event.currentTarget) {
      event.preventDefault()
      finishZone()
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      visitHistory(event.shiftKey ? redo : undo)
    }
  }

  async function loadClip(file: File) {
    try {
      const loaded = parseClip(await file.text())
      clearDraft()
      seek(loaded.start_t)
      setSelected(null)
      setHistory(previous => push(previous, loaded))
      setNotice('Teaching Clip loaded.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load this Teaching Clip.')
    }
  }

  function changeRange(bound: 'start_t' | 'end_t', value: number) {
    if (!Number.isFinite(value) || value < 0) return false
    const start = bound === 'start_t' ? value : clip.start_t
    const end = bound === 'end_t' ? value : clip.end_t
    if (start > end) {
      setNotice('Clip end must be at or after its start.')
      return false
    }
    const changed = clip.annotations_json.map(a => ({
      ...a,
      t_from: a.t_from === clip.start_t ? start : a.t_from,
      t_to: a.t_to === clip.end_t ? end : a.t_to,
    }))
    if (changed.some(a => a.t_from < start || a.t_to > end || a.t_from > a.t_to) ||
      clip.ghosts_json.some(g => g.keyframes.some(k => k.t < start || k.t > end))) {
      setNotice('The new range would exclude an annotation or keyframe.')
      return false
    }
    if (clip[bound] !== value) {
      seek(clamp(currentTime, start, end))
      edit(previous => ({ ...previous, [bound]: value, annotations_json: changed }))
    }
    return true
  }

  const filename = clip.title.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'teaching-clip'
  async function exportPng() {
    if (!rink.current || !surface.current || !canvas.current) return
    try {
      download(await rinkPng(rink.current, canvas.current, surface.current), `${filename}.png`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not export this PNG.')
    }
  }

  const preview = draft && 'points' in draft ? annotationAt('draft', clip, draft.tool, draft.points, color)
    : polygon.length ? annotationAt('draft', clip, 'polygon', polygon, color) : undefined
  const displayGhosts = playing ? (layers.ghosts ? ghostMarkers(clip, playerList, currentTime) : []) : shownGhosts
  const displayAnnotations = playing && layers.annotations
    ? clip.annotations_json.filter(a => a.t_from <= currentTime && currentTime <= a.t_to) : annotations
  const movingOriginal = dragging?.tool === 'move' && 'manualId' in dragging.player
  const temporaryGhost = dragging && !movingOriginal && distance(dragging.start, dragging.point) > .14 ? {
    ...dragging.player,
    original: 'trackId' in dragging.player ? dragging.player.point : dragging.player.original,
    point: dragging.point,
  } : undefined
  const displayPlayers = dragging && movingOriginal
    ? shownPlayers.map(player => player.key === dragging.player.key ? { ...player, point: dragging.point } : player)
    : shownPlayers
  const timelineFrames = selectedGhost?.keyframes ??
    clip.ghosts_json.flatMap(g => g.keyframes).sort((a, b) => a.t - b.t)
  const activeTool = tools.find(entry => entry[0] === tool)!
  const duration = clip.end_t - clip.start_t
  const classes = presenting ? 'rvb rvb-presenting' : 'rvb'

  return <section ref={root} className={classes} aria-label="Tactics board" tabIndex={-1}
    onKeyDown={onKeyDown} onPointerDown={event => {
      if (event.target === surface.current || surface.current?.contains(event.target as Node)) {
        root.current?.focus({ preventScroll: true })
      }
    }}>
    <header className="rvb-command">
      <div className="rvb-identity">
        <span className="rvb-kicker">{presenting ? 'PRESENTATION' : 'BOARD EDITOR'}</span>
        <strong>{clip.title || 'Untitled teaching clip'}</strong>
      </div>
      <div className="rvb-actions">
        {!presenting && <>
          <button aria-label="Undo" title="Undo (Ctrl/⌘ Z)" disabled={!history.past.length} onClick={() => visitHistory(undo)}><Icon name="undo" /></button>
          <button aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)" disabled={!history.future.length} onClick={() => visitHistory(redo)}><Icon name="redo" /></button>
          <span className="rvb-command-divider" />
          <button onClick={() => fileInput.current?.click()}><Icon name="upload" /> Load JSON</button>
          <button onClick={() => download(new Blob([serializeClip(clip)], { type: 'application/json' }), `${filename}.json`)}><Icon name="download" /> Save JSON</button>
          <button disabled={playing || Boolean(preview || measureAnchor)} onClick={() => void exportPng()}><Icon name="image" /> Export PNG</button>
          <input type="file" aria-label="Load Teaching Clip" accept=".json,application/json" hidden ref={fileInput}
            onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void loadClip(file)
            }} />
        </>}
        <button className="rvb-primary" onClick={() => void present()}>
          <Icon name={presenting ? 'close' : 'screen'} /> {presenting ? 'Exit presentation' : 'Present'}
        </button>
      </div>
    </header>
    <div className="rvb-workspace">
      {!presenting && <aside className="rvb-toolbar" aria-label="Board tools">
        <span className="rvb-kicker">TOOLS</span>
        {tools.map(([value, label, hint, icon]) => <button key={value} aria-pressed={tool === value}
          title={hint} onClick={() => chooseTool(value)}><Icon name={icon} /><span>{label}</span></button>)}
      </aside>}
      <div className="rvb-stage">
        <div className="rvb-rink-header">
          <span><i /> RINK VIEW</span>
          <span>{rinkTemplate.length_m} × {rinkTemplate.width_m} m</span>
        </div>
        <div className="rvb-ice">
          <BoardSurface template={rinkTemplate} players={displayPlayers}
            ghosts={temporaryGhost ? [...displayGhosts.filter(g => g.key !== temporaryGhost.key), temporaryGhost] : displayGhosts}
            annotations={preview ? [...displayAnnotations, preview] : displayAnnotations}
            selected={selected} presentation={presenting} surfaceRef={surface} rinkRef={rink}
            canvasRef={canvas} onPointerDown={startPointer} onPointerMove={movePointer} onPointerUp={endPointer}
            onPointerCancel={() => setDraft(null)} cursor={presenting || playing ? 'default' : tool === 'ghost' || tool === 'select' ? 'grab' : 'crosshair'}
            marker={measureAnchor} />
        </div>
        {!presenting && <div className="rvb-context">
          <div className="rvb-help"><Icon name={activeTool[3]} /><span>{activeTool[2]}</span></div>
          {(tool === 'polygon' || measureAnchor) && <div className="rvb-context-controls">
            {tool === 'polygon' && <button onClick={finishZone} disabled={!canFinishZone(polygon)}>Finish zone</button>}
            <button onClick={clearDraft}>Cancel</button>
          </div>}
          {tool === 'label' && <input aria-label="Label text" placeholder="e.g. Weak-side D" value={text}
            onChange={event => setText(event.target.value)} />}
          {tool === 'player' && <div className="rvb-context-controls">
            <select aria-label="New player team" value={team} onChange={event => setTeam(event.target.value as Team)}>
              <option value="A">Team A</option><option value="B">Team B</option><option value="none">Neutral</option>
            </select>
            <select aria-label="New player role" value={role} onChange={event => setRole(event.target.value as Role)}>
              <option value="player">Skater</option><option value="goalie">Goalie</option><option value="referee">Referee</option>
            </select>
          </div>}
        </div>}
        <div className="rvb-timeline">
          <button className="rvb-play" aria-label={playing ? 'Pause animation' : 'Play animation'} disabled={!duration}
            onClick={play}><Icon name={playing ? 'pause' : 'play'} /></button>
          <div className="rvb-timebody">
            <div className="rvb-timehead">
              <span className="rvb-kicker">CLIP TIMELINE</span>
              <output aria-label="Playhead time" aria-live="off">{currentTime.toFixed(2)} / {clip.end_t.toFixed(2)} s</output>
            </div>
            <input className="rvb-range" type="range" aria-label="Clip playhead" min={clip.start_t} max={clip.end_t}
              step="any" value={currentTime} disabled={!duration} onChange={event => seek(event.target.valueAsNumber)} />
            <div className="rvb-ticks" aria-label="Ghost keyframes">
              {duration > 0 && [...new Set(timelineFrames.map(frame => frame.t))].map(t => <button key={t}
                style={{ left: `${(t - clip.start_t) / duration * 100}%` }}
                title={`Jump to keyframe at ${t.toFixed(2)} s`} aria-label={`Jump to keyframe at ${t.toFixed(2)} s`}
                onClick={() => seek(t)}><Icon name="key" /></button>)}
            </div>
          </div>
        </div>
      </div>
      {!presenting && <aside className="rvb-inspector" aria-label="Clip settings">
        <div className="rvb-inspector-block">
          <h2>Teaching clip</h2>
          <label>Title
            <input value={clip.title} placeholder="Name this teaching moment"
              onChange={event => {
                const title = event.target.value
                edit(previous => ({ ...previous, title }))
              }} />
          </label>
          <label>Notes
            <textarea value={clip.notes} placeholder="What should the team see?" rows={3}
              onChange={event => {
                const notes = event.target.value
                edit(previous => ({ ...previous, notes }))
              }} />
          </label>
          <label>Tags <span className="rvb-subtle">(comma-separated)</span>
            <input key={clip.tags.join(', ')} defaultValue={clip.tags.join(', ')} placeholder="Breakout, coverage"
              onBlur={event => {
                const tags = event.target.value.split(',').map(s => s.trim()).filter(Boolean)
                if (tags.join(', ') !== clip.tags.join(', ')) edit(previous => ({ ...previous, tags }))
                else event.target.value = clip.tags.join(', ')
              }} />
          </label>
          <div className="rvb-bounds">
            {(['start_t', 'end_t'] as const).map(bound => <label key={bound}>{bound === 'start_t' ? 'Start (s)' : 'End (s)'}
              <input type="number" min="0" step="any" key={clip[bound]} defaultValue={clip[bound]}
                onBlur={event => {
                  if (!changeRange(bound, event.target.valueAsNumber)) event.target.value = String(clip[bound])
                }} />
            </label>)}
          </div>
        </div>
        <div className="rvb-inspector-block">
          <h2><Icon name="eye" /> Layers</h2>
          {(Object.keys(layers) as (keyof Layers)[]).map(layer => <label className="rvb-layer" key={layer}>
            <span>{layer === 'players' ? 'Players' : layer === 'ghosts' ? 'Ghosts' : 'Annotations'}</span>
            <input type="checkbox" checked={layers[layer]} onChange={() =>
              setLayers(previous => ({ ...previous, [layer]: !previous[layer] }))} />
          </label>)}
          <span className="rvb-kicker rvb-ink-label">ANNOTATION INK</span>
          <div className="rvb-palette" aria-label="Annotation ink">
            {colors.map(([name, value]) => <button key={value} className="rvb-swatch" style={{ background: value }}
              aria-label={name} title={name} aria-pressed={color === value} onClick={() => setColor(value)} />)}
          </div>
        </div>
        {selectedMarker && <div className="rvb-inspector-block">
          <h2><span className="rvb-team-dot" style={{
            background: teamColor(selectedMarker.team, selectedPlayer?.role),
          }} />{selectedPlayer ? `Player ${selectedPlayer.caption}` : 'Ghost player'}</h2>
          {selectedPlayer && initialPlayers.find(p => p.track_id === selectedPlayer.trackId)?.on_ice !== false &&
            <button onClick={() => toggleHidden(selectedPlayer)}>{selectedPlayer.hidden ? 'Show player' : 'Hide player'}</button>}
          {selectedGhost && <div className="rvb-keyframes">
            <span className="rvb-kicker">GHOST KEYFRAMES</span>
            {selectedGhost.keyframes.map(frame => <div key={frame.t}>
              <button onClick={() => seek(frame.t)}><Icon name="key" /> {frame.t.toFixed(2)} s</button>
              <button aria-label={`Remove keyframe at ${frame.t.toFixed(2)} s`}
                onClick={() => removeKeyframe(selectedGhost, frame.t)}><Icon name="close" /></button>
            </div>)}
          </div>}
        </div>}
        {(playerList.some(player => player.hidden) || clip.annotations_json.length > 0) && <details className="rvb-inspector-block rvb-items">
          <summary>Board items</summary>
          {playerList.filter(player => player.hidden).map(player => <button key={player.key} onClick={() => setSelected(player.key)}>
            Player {player.caption} (hidden)
          </button>)}
          {clip.annotations_json.map(annotation => <div className="rvb-item" key={annotation.id}>
            <span>{annotation.style.text || annotation.kind}</span>
            <button aria-label={`Remove ${annotation.style.text || annotation.kind}`} onClick={() => edit(previous => ({
              ...previous, annotations_json: previous.annotations_json.filter(a => a.id !== annotation.id),
            }))}><Icon name="close" /></button>
          </div>)}
        </details>}
      </aside>}
    </div>
    {notice && <div role="status" className="rvb-notice">{notice}</div>}
  </section>
}
