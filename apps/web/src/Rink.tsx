import { memo, useId, useLayoutEffect, useRef } from 'react';
import type { PointerEvent, RefObject } from 'react';
import type { Heatmap, PlayingTeam, Position, RinkTemplate, Team } from './contracts';
import { canvasProjection, heatmapCentroid, rinkGeometry, RINK_PADDING, TEAM_COLORS } from './rinkGeometry';
import { effectiveTeam, trackTrails } from './samples';
import type { Sample } from './samples';

const SIGNS = [-1, 1];
const RED = '#bc6075';
const BLUE = '#6889bf';

const RinkSvg = memo(function RinkSvg({ rink }: { rink: RinkTemplate }) {
  const clipId = useId();
  const g = rinkGeometry(rink);
  const outline = { x: -g.x, y: -g.y, width: rink.length_m, height: rink.width_m, rx: g.r };
  return (
    <svg aria-hidden="true" className="rink-svg" viewBox={`${-g.x - RINK_PADDING} ${-g.y - RINK_PADDING} ${g.paddedWidth} ${g.paddedHeight}`}>
      <defs><clipPath id={clipId}><rect {...outline} /></clipPath></defs>
      <g transform="scale(1,-1)">
        <rect {...outline} fill="#f7faff" />
        <g clipPath={`url(#${clipId})`}>
          <rect x={-g.blueX} y={-g.y} width={g.blueX * 2} height={rink.width_m} fill="#edf4ff" />
          <line y1={-g.y} y2={g.y} stroke={RED} strokeWidth=".23" x1={0} x2={0} />
          <circle r={rink.faceoff_circle_radius_m} fill="none" stroke={BLUE} strokeWidth=".15" />
          <circle r=".22" fill={BLUE} />
          {SIGNS.map(s => (
            <g key={s} transform={`scale(${s},1)`}>
              <line x1={g.blueX} x2={g.blueX} y1={-g.boardY(g.blueX)} y2={g.boardY(g.blueX)} stroke={BLUE} strokeWidth=".28" />
              <line x1={g.goalX} x2={g.goalX} y1={-g.boardY(g.goalX)} y2={g.boardY(g.goalX)} stroke={RED} strokeWidth=".15" />
              <path d={`M ${g.goalX} ${-g.goalHalfWidth} h 0.85 q .36 0 .36 .36 v ${g.goalHalfWidth * 2 - 0.72} q 0 .36 -.36 .36 h -.85`}
                stroke={RED} strokeWidth=".16" fill="#ffffff" />
              {SIGNS.map(side => (
                <g key={side} transform={`scale(1,${side})`}>
                  <circle cx={g.endX} cy={rink.end_faceoff.from_centre_y_m} r={rink.faceoff_circle_radius_m} fill="none" stroke={RED} strokeWidth=".15" />
                  <circle cx={g.endX} cy={rink.end_faceoff.from_centre_y_m} r=".22" fill={RED} />
                  <circle cx={g.neutralX} cy={rink.neutral_faceoff.from_centre_y_m} r=".22" fill={RED} />
                  {rink.trapezoid && <line x1={g.goalX} y1={rink.trapezoid.goal_line_half_width_m}
                    x2={g.x} y2={rink.trapezoid.end_boards_half_width_m} stroke={RED} strokeWidth=".15" />}
                </g>
              ))}
            </g>
          ))}
        </g>
        <rect {...outline} fill="none" stroke="#839cbc" strokeWidth=".25" />
      </g>
    </svg>
  );
});

function useCanvas(ref: RefObject<HTMLCanvasElement | null>, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const paintRef = useRef(paint);
  useLayoutEffect(() => {
    paintRef.current = paint;
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const draw = () => drawCanvas(canvas, ctx, paintRef.current);
    draw();
  }, [ref, paint]);
  useLayoutEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const observer = new ResizeObserver(() => drawCanvas(canvas, ctx, paintRef.current));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [ref]);
}

function drawCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const { width, height } = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(width * dpr);
  const h = Math.round(height * dpr);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (w && h) paint(ctx, width, height);
}

function dotRadius(scale: number) {
  return Math.max(4, Math.min(10, scale * 0.71));
}

interface TrackRinkProps {
  rink: RinkTemplate;
  samples: Sample[];
  sample?: Sample;
  dots: Position[];
  trails: number;
  selected: number | null;
  overrides: ReadonlyMap<number, Team>;
  ids: boolean;
  onSelect(id: number | null): void;
}

export function TrackRink({ rink, samples, sample, dots, trails, selected, overrides, ids, onSelect }: TrackRinkProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useCanvas(ref, (ctx, w, h) => {
    if (!sample) return;
    const project = canvasProjection(rink, w, h);
    const radius = dotRadius(project.scale);
    const byId = new Map(dots.map(p => [p.track_id, p]));
    const paths = trackTrails(samples, sample.time, trails, new Set(byId.keys()));
    for (const [id, segments] of paths) {
      const point = byId.get(id);
      if (!point) continue;
      ctx.strokeStyle = TEAM_COLORS[effectiveTeam(point, overrides)];
      ctx.lineWidth = id === selected ? 3 : 2;
      ctx.lineCap = 'round';
      for (const path of segments) {
        for (let i = 1; i < path.length; i++) {
          ctx.globalAlpha = 0.12 + 0.52 * Math.max(0, 1 - (sample.time - path[i].t) / trails);
          ctx.beginPath();
          ctx.moveTo(project.x(path[i - 1].x_m), project.y(path[i - 1].y_m));
          ctx.lineTo(project.x(path[i].x_m), project.y(path[i].y_m));
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    for (const p of dots) {
      const x = project.x(p.x_m);
      const y = project.y(p.y_m);
      if (p.track_id === selected) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#132743';
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = TEAM_COLORS[effectiveTeam(p, overrides)];
      ctx.fill();
      ctx.lineWidth = p.role === 'goalie' ? 2.2 : 1.25;
      ctx.strokeStyle = p.role === 'goalie' ? '#182f4c' : '#fff';
      ctx.stroke();
      if (ids || p.track_id === selected) {
        ctx.fillStyle = '#122642';
        ctx.strokeStyle = '#f7faff';
        ctx.lineWidth = 3;
        ctx.font = 'bold 11px system-ui';
        ctx.strokeText(String(p.track_id), x + radius + 3, y + 4);
        ctx.fillText(String(p.track_id), x + radius + 3, y + 4);
      }
    }
  });

  function hitTest(event: PointerEvent<HTMLCanvasElement>) {
    const { left, top, width, height } = event.currentTarget.getBoundingClientRect();
    const p = canvasProjection(rink, width, height);
    let distance = dotRadius(p.scale) + 6;
    let id: number | null = null;
    for (const dot of [...dots].reverse()) {
      const d = Math.hypot(p.x(dot.x_m) - (event.clientX - left), p.y(dot.y_m) - (event.clientY - top));
      if (d < distance) {
        id = dot.track_id;
        distance = d;
      }
    }
    onSelect(id);
  }

  return (
    <div className="rink-surface" style={{ aspectRatio: `${rink.length_m + 3} / ${rink.width_m + 3}` }}>
      <RinkSvg rink={rink} />
      <canvas ref={ref} onPointerDown={hitTest} aria-label="Tracked players. Use the track selector to select a player with the keyboard." />
    </div>
  );
}

export function HeatmapRink({ rink, map, team, peak }: { rink: RinkTemplate; map: Heatmap; team: PlayingTeam; peak: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useCanvas(ref, (ctx, w, h) => {
    const p = canvasProjection(rink, w, h);
    const { x_min_m, y_min_m, grid, cell_size_m } = map;
    const unit = cell_size_m * p.scale;
    const g = rinkGeometry(rink);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(p.x(-g.x), p.y(g.y), rink.length_m * p.scale, rink.width_m * p.scale, g.r * p.scale);
    ctx.clip();
    ctx.fillStyle = TEAM_COLORS[team];
    grid.forEach((row, j) => row.forEach((value, i) => {
      if (value <= 0) return;
      ctx.globalAlpha = 0.14 + 0.79 * Math.sqrt(value / peak);
      ctx.fillRect(p.x(x_min_m + i * cell_size_m), p.y(y_min_m + (j + 1) * cell_size_m), unit, unit);
    }));
    const centroid = heatmapCentroid(map);
    if (centroid) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#132743';
      ctx.lineWidth = 1.5;
      const x = p.x(centroid.x);
      const y = p.y(centroid.y);
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  });
  return (
    <div className="rink-surface heat-rink" style={{ aspectRatio: `${rink.length_m + 3} / ${rink.width_m + 3}` }}>
      <RinkSvg rink={rink} />
      <canvas ref={ref} role="img" aria-label={`Team ${team} heatmap`} />
    </div>
  );
}
