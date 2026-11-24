import { useLayoutEffect, useRef } from 'react'
import type { CSSProperties, PointerEventHandler, RefObject } from 'react'
import { distance, rinkGeometry, toSvg } from './geometry'
import { Rink } from './Rink'
import { teamColor } from './players'
import type { GhostMarker, Player } from './players'
import type { Annotation, Point, RinkTemplate, TacticsBoardProps } from './types'

export const INK = '#124eaa'
export const EDITOR_MARKER_RADIUS = .74

function LineArrow({ from, to, color, dashed = false, weight = .24 }: {
  from: Point; to: Point; color: string; dashed?: boolean; weight?: number
}) {
  const [x1, y1] = from
  const [x2, y2] = to
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const length = Math.min(.9, distance(from, to) * .42)
  const dx = Math.cos(angle) * length
  const dy = Math.sin(angle) * length
  return <g fill="none" stroke={color} strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round">
    <line {...{ x1, y1, x2, y2 }} strokeDasharray={dashed ? '.65 .45' : undefined} />
    <path d={`M ${x2 - dx + dy * .48} ${y2 - dy - dx * .48} L ${x2} ${y2} L ${x2 - dx - dy * .48} ${y2 - dy + dx * .48}`} />
  </g>
}

function BoardAnnotation({ annotation }: { annotation: Annotation }) {
  const { kind, style } = annotation
  const points = annotation.points_m.map(toSvg)
  const [a, b] = points
  const color = style.color ?? INK
  const vertices = points.map(p => p.join(',')).join(' ')
  const stroke = { stroke: color, strokeWidth: .23, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  const label = (point: Point, text: string, centered = false) => (
    <text x={point[0]} y={point[1]} dy="-.5" fill={color} stroke="#f5faff" strokeWidth=".28"
      paintOrder="stroke" fontFamily="system-ui, sans-serif" fontWeight="750" fontSize="1.08"
      textAnchor={centered ? 'middle' : 'start'}>{text}</text>
  )
  switch (kind) {
    case 'arrow':
    case 'pass':
      return b && <LineArrow from={a} to={b} color={color} dashed={kind === 'pass'} />
    case 'zone':
      return points.length > 2
        ? <polygon points={vertices} {...stroke} fill={color} fillOpacity=".17" />
        : <polyline points={vertices} {...stroke} fill="none" />
    case 'pen':
    case 'line':
      return <polyline points={vertices} {...stroke} fill="none" />
    case 'label':
      return label(a, style.text ?? '')
    case 'spotlight':
      return <g>
        <circle cx={a[0]} cy={a[1]} r="1.55" fill="none" {...stroke} opacity=".28" strokeWidth=".55" />
        <circle cx={a[0]} cy={a[1]} r="1.33" fill="none" {...stroke} />
      </g>
    case 'measure': {
      if (!b) return null
      return <g>
        <polyline points={vertices} {...stroke} fill="none" strokeDasharray=".3 .21" />
        {points.map(([x, y], index) => <circle key={index} cx={x} cy={y} r=".19" fill={color} />)}
        {label([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], `${distance(a, b).toFixed(1)} m`, true)}
      </g>
    }
  }
}

interface SurfaceProps {
  template: RinkTemplate
  players: Player[]
  ghosts: GhostMarker[]
  annotations: Annotation[]
  selected: string | null
  presentation: boolean
  surfaceRef: RefObject<SVGSVGElement | null>
  rinkRef: RefObject<SVGSVGElement | null>
  canvasRef: RefObject<HTMLCanvasElement | null>
  onPointerDown: PointerEventHandler<SVGSVGElement>
  onPointerMove: PointerEventHandler<SVGSVGElement>
  onPointerUp: PointerEventHandler<SVGSVGElement>
  onPointerCancel: PointerEventHandler<SVGSVGElement>
  cursor: string
  marker?: Point
  teamColors?: TacticsBoardProps['teamColors']
}

export function BoardSurface({
  template, players, ghosts, annotations, selected, presentation, surfaceRef, rinkRef,
  canvasRef, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, cursor, marker, teamColors,
}: SurfaceProps) {
  const { width, height } = rinkGeometry(template)
  const viewBox = `${-width / 2} ${-height / 2} ${width} ${height}`
  const stack = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const area = stack.current
    if (!canvas || !area) return
    const draw = () => {
      const rect = area.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const pixelWidth = Math.max(1, Math.round(rect.width * dpr))
      const pixelHeight = Math.max(1, Math.round(rect.height * dpr))
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, pixelWidth, pixelHeight)
      const scale = Math.min(pixelWidth / width, pixelHeight / height)
      ctx.setTransform(scale, 0, 0, scale, pixelWidth / 2, pixelHeight / 2)
      const faded = new Set(ghosts.map(ghost => ghost.key))
      const markerRadius = presentation ? .94 : EDITOR_MARKER_RADIUS
      for (const player of players) {
        const [x, y] = toSvg(player.point)
        ctx.globalAlpha = faded.has(player.key) ? .29 : 1
        ctx.beginPath()
        ctx.arc(x, y, markerRadius, 0, Math.PI * 2)
        ctx.fillStyle = teamColor(player.team, player.role, teamColors)
        ctx.fill()
        ctx.strokeStyle = player.role === 'goalie' ? '#192843' : '#fff'
        ctx.lineWidth = player.role === 'goalie' ? .21 : .13
        ctx.stroke()
        ctx.fillStyle = '#fff'
        ctx.font = `700 ${markerRadius * (player.caption.length > 2 ? .69 : .91)}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(player.caption, x, y, markerRadius * 1.65)
        if (player.key === selected && !faded.has(player.key) && !presentation) {
          ctx.beginPath()
          ctx.arc(x, y, markerRadius + .24, 0, Math.PI * 2)
          ctx.strokeStyle = '#0f766e'
          ctx.lineWidth = .14
          ctx.stroke()
        }
      }
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(area)
    return () => observer.disconnect()
  }, [canvasRef, width, height, players, ghosts, selected, presentation, teamColors])

  return <div className="rvb-surface" ref={stack}
    style={{ aspectRatio: width / height, '--rvb-ratio': width / height } as CSSProperties}>
    <svg ref={rinkRef} aria-hidden="true" viewBox={viewBox} xmlns="http://www.w3.org/2000/svg">
      <Rink template={template} />
    </svg>
    <canvas ref={canvasRef} aria-hidden="true" />
    <svg ref={surfaceRef} aria-label="Interactive rink" viewBox={viewBox} style={{ cursor }}
      xmlns="http://www.w3.org/2000/svg" onPointerDown={onPointerDown}
      onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
      {annotations.map(annotation => <BoardAnnotation key={annotation.id} annotation={annotation} />)}
      {ghosts.map(ghost => {
        const point = toSvg(ghost.point)
        const color = teamColor(ghost.team, ghost.role, teamColors)
        const radius = presentation ? .94 : EDITOR_MARKER_RADIUS
        const from = ghost.original ? toSvg(ghost.original) : undefined
        const length = from ? distance(from, point) : 0
        const end = from && length > radius * 2.1
          ? point.map((coord, i) => coord - (coord - from[i]) * (radius + .17) / length) as Point : undefined
        return <g key={ghost.key}>
          {from && end && <LineArrow from={from} to={end} color={color} dashed weight={.2} />}
          <circle cx={point[0]} cy={point[1]} r={radius + .29} fill={color} fillOpacity=".12" />
          <circle cx={point[0]} cy={point[1]} r={radius} fill="#fff" stroke={color} strokeWidth=".24" />
          {ghost.caption && <text x={point[0]} y={point[1]} dy=".34em" textAnchor="middle"
            fill={color} fontFamily="system-ui, sans-serif" fontSize={radius * (ghost.caption.length > 2 ? .61 : .87)}
            fontWeight="800">{ghost.caption}</text>}
        </g>
      })}
      {marker && <circle cx={marker[0]} cy={-marker[1]} r=".22" fill="#008476" />}
    </svg>
  </div>
}
