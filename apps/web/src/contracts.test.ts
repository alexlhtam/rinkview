import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import examplePositions from '../../../shared/schemas/positions.example.json';
import exampleSummary from '../../../shared/schemas/summary.example.json';
import rink from '../../../shared/rink_templates/ally-pally-estimate.json';
import { isPositions, isRinkTemplate, isSummary } from './contracts';

it('accepts the shared contract examples and rejects an invalid team or rink geometry', () => {
  expect(isPositions(examplePositions)).toBe(true);
  expect(isSummary(exampleSummary)).toBe(true);
  expect(isRinkTemplate(rink)).toBe(true);
  expect(isPositions([{ ...examplePositions[0], team: null }])).toBe(false);
  expect(isRinkTemplate({ ...rink, corner_radius_m: rink.width_m })).toBe(false);
});

it('generates 30 seconds of on-ice tracks and consistent period totals', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rinkview-test-'));
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/generate-demo.mjs', import.meta.url)), directory]);
    const positions: unknown = JSON.parse(await readFile(join(directory, 'positions.json'), 'utf8'));
    const summary: unknown = JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8'));
    if (!isPositions(positions) || !isSummary(summary)) throw new Error('Generated JSON does not satisfy the schemas');
    expect(positions).toHaveLength(4200);
    expect(new Set(positions.map(row => row.track_id)).size).toBe(14);
    expect(positions.filter(row => Math.hypot(row.vx, row.vy) > 12)).toHaveLength(0);
    const [period] = summary.periods;
    for (const team of ['A', 'B'] as const) {
      expect(Object.values(period.zone_time[team]).reduce((sum, n) => sum + n, 0)).toBeCloseTo(180);
      expect(period.heatmaps[team].grid.flat().reduce((sum, n) => sum + n, 0)).toBeCloseTo(180);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
