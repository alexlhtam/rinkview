import { isPositions, isRinkTemplate, isSummary } from './contracts';
import type { Position, RinkTemplate, Summary } from './contracts';
import { estimateFps, groupSamples, lowerBound } from './samples';
import type { Sample } from './samples';
import type { Activity } from './timeline';

export interface PositionSource {
  readWindow(start: number, end: number): Promise<Sample[]>;
}

export interface GameData {
  videoUrl: string;
  videoName: string;
  rink: RinkTemplate;
  summary: Summary;
  positions: PositionSource;
  tracks: Position[];
  activity: Activity;
  fps?: number;
  dispose(): void;
}

export interface GameFiles {
  video: File;
  positions: File;
  summary: File;
  rink: File;
}

async function readJson(file: File): Promise<unknown> {
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error(`${file.name}: could not read valid JSON.`);
  }
}

export async function loadLocalGame(files: GameFiles): Promise<GameData> {
  const [rows, summary, rink] = await Promise.all([readJson(files.positions), readJson(files.summary), readJson(files.rink)]);
  if (!isPositions(rows)) {
    throw new Error(`${files.positions.name}: invalid positions at ${isPositions.errors?.[0]?.instancePath || '/'}.`);
  }
  if (!isSummary(summary)) {
    throw new Error(`${files.summary.name}: invalid summary at ${isSummary.errors?.[0]?.instancePath || '/'}.`);
  }
  for (const period of summary.periods) {
    for (const { grid } of Object.values(period.heatmaps)) {
      if (grid.some(row => row.length !== grid[0].length)) {
        throw new Error(`${files.summary.name}: heatmap rows must have equal lengths.`);
      }
    }
  }
  if (!isRinkTemplate(rink)) throw new Error(`${files.rink.name}: invalid rink template.`);

  const samples = groupSamples(rows);
  const tracks = new Map<number, Position>();
  const start = samples[0]?.time ?? 0;
  const end = samples.at(-1)?.time ?? 0;
  const bins = Array<number>(100).fill(0);
  const sampleCounts = Array<number>(100).fill(0);
  for (const sample of samples) {
    const bin = end === start ? 0 : Math.min(99, Math.floor(100 * (sample.time - start) / (end - start)));
    sampleCounts[bin]++;
    for (const row of sample.positions) {
      if (!tracks.has(row.track_id)) tracks.set(row.track_id, row);
      if (row.on_ice && row.role !== 'referee') bins[bin] += Math.hypot(row.vx, row.vy);
    }
  }
  const videoUrl = URL.createObjectURL(files.video);
  return {
    videoUrl,
    videoName: files.video.name,
    rink,
    summary,
    fps: estimateFps(samples),
    activity: { start, end, bins: bins.map((total, i) => total / (sampleCounts[i] || 1)) },
    tracks: [...tracks.values()].sort((a, b) => a.track_id - b.track_id),
    positions: {
      async readWindow(from, to) {
        return samples.slice(lowerBound(samples, from), lowerBound(samples, to));
      },
    },
    dispose: () => URL.revokeObjectURL(videoUrl),
  };
}
