import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const defaultTemplate = new URL('../../../shared/rink_templates/ally-pally-estimate.json', import.meta.url);
const defaultOutput = new URL('../../../data/web-demo/', import.meta.url);
const [output, template, sourceRate = '60'] = process.argv.slice(2);
const outputDir = output ? resolve(output) : defaultOutput.pathname;
const rink = JSON.parse(await readFile(template ?? defaultTemplate, 'utf8'));
const fps = Number(sourceRate);
if (!Number.isFinite(fps) || fps < 10) throw new Error('Source frame rate must be at least 10 fps.');

const hz = 10;
const duration = 30;
const halfLength = rink.length_m / 2;
const halfWidth = rink.width_m / 2;
const goalX = halfLength - rink.goal_line_from_end_m;
const cell = 1;
const teams = ['A', 'B'];
const round = (value) => Number(value.toFixed(4));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const byTeam = (fn) => Object.fromEntries(teams.map(team => [team, fn(team)]));
const heatmaps = byTeam(() => ({
  x_min_m: -halfLength, y_min_m: -halfWidth, cell_size_m: cell,
  grid: Array.from({ length: Math.ceil(rink.width_m / cell) }, () => Array(Math.ceil(rink.length_m / cell)).fill(0)),
}));
const zone_time = byTeam(() => ({ defensive_s: 0, neutral_s: 0, offensive_s: 0 }));

const players = teams.flatMap((team, i) => [
  ...Array.from({ length: 5 }, (_, lane) => ({ team, role: 'player', side: i ? 1 : -1, lane })),
  { team, role: 'goalie', side: i ? 1 : -1, lane: 0 },
]);
players.push({ team: 'none', role: 'referee', side: -1, lane: 0 }, { team: 'none', role: 'referee', side: 1, lane: 0 });

function location({ side, lane, role }, t) {
  const phase = Math.PI * t / 8;
  const rush = 0.51 * halfLength * Math.sin(phase - 0.65);
  let x;
  let y;
  if (role === 'goalie') {
    x = side * (goalX - 1.25 + 0.55 * Math.sin(phase + side));
    y = 1.2 * Math.sin(phase + side * 1.4);
  } else if (role === 'referee') {
    x = side * halfLength * 0.35 + 0.52 * rush;
    y = side * halfWidth * 0.78 + 0.7 * Math.cos(phase);
  } else {
    const depth = [1.2, 2.4, 3.6, 8.2, 9.3][lane];
    const wing = [0, -0.51, 0.49, -0.24, 0.30][lane];
    x = rush + side * depth + 2.6 * Math.sin(phase * 1.17 + lane * 1.7 + side);
    y = halfWidth * (wing + 0.21 * Math.sin(phase * 0.66 + lane * 0.67 + side));
  }
  x = clamp(x, -halfLength + 0.6, halfLength - 0.6);
  const r = rink.corner_radius_m;
  const dx = Math.max(0, Math.abs(x) - (halfLength - r));
  const edge = halfWidth - r + Math.sqrt(r * r - dx * dx);
  return [x, clamp(y, -edge + 0.4, edge - 0.4)];
}

const positions = [];
for (let tick = 0; tick < duration * hz; tick++) {
  const t = tick / hz;
  players.forEach((player, index) => {
    const { team, role, side } = player;
    const [x, y] = location(player, t);
    const [px, py] = location(player, t - 0.01);
    const [nx, ny] = location(player, t + 0.01);
    positions.push({
      t, frame: Math.round(t * fps), track_id: index + 1, role, team,
      x_m: round(x), y_m: round(y), vx: round((nx - px) / 0.02), vy: round((ny - py) / 0.02),
      conf: round(0.91 + 0.07 * Math.sin(t * 0.63 + index)), on_ice: true, interpolated: false,
    });
    if (team === 'none') return;
    const map = heatmaps[team];
    map.grid[Math.floor((y - map.y_min_m) / cell)][Math.floor((x - map.x_min_m) / cell)] += 1 / hz;
    const blue = rink.blue_line_from_centre_m;
    const defendingX = x * side;
    const zone = defendingX > blue ? 'defensive_s' : defendingX < -blue ? 'offensive_s' : 'neutral_s';
    zone_time[team][zone] += 1 / hz;
  });
}
for (const team of teams) {
  heatmaps[team].grid = heatmaps[team].grid.map(row => row.map(round));
  for (const zone of Object.keys(zone_time[team])) zone_time[team][zone] = round(zone_time[team][zone]);
}

const summary = {
  periods: [{ period: 1, zone_time, heatmaps, track_counts: { A: 6, B: 6, none: 2 } }],
  processing_stats: { source_frames: Math.round(duration * fps), processed_frames: duration * hz, elapsed_s: 0 },
  drift_warnings: [],
};

await mkdir(outputDir, { recursive: true });
await Promise.all([
  writeFile(join(outputDir, 'positions.json'), JSON.stringify(positions) + '\n'),
  writeFile(join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n'),
]);
console.log(`Wrote ${positions.length} rows (14 tracks, 30 s at 10 Hz) and summary to ${outputDir}`);
