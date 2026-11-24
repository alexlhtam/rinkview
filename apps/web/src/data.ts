import { isPositions, isRinkTemplate, isSummary } from './contracts';
import type { Position, RinkTemplate, Summary } from './contracts';
import { estimateFps, groupSamples, lowerBound } from './samples';
import type { Sample } from './samples';
import type { Activity } from './timeline';
import allyPally from '../../../shared/rink_templates/ally-pally-estimate.json';
import custom from '../../../shared/rink_templates/custom-uk-56x26.json';
import iihf from '../../../shared/rink_templates/iihf.json';
import nhl from '../../../shared/rink_templates/nhl.json';

const templates = new Map<string, RinkTemplate>([
  ['ally-pally-estimate.json', allyPally], ['custom-uk-56x26.json', custom],
  ['iihf.json', iihf], ['nhl.json', nhl],
]);

export interface PositionSource {
  readWindow(start: number, end: number): Promise<Sample[]>;
}

export interface GameData {
  videoUrl: string;
  videoName: string;
  videoId: string;
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
  positions?: File;
  summary?: File;
  rink?: File;
  calibration?: File;
  folder?: readonly File[];
}

async function readJson(file: File): Promise<unknown> {
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error(`${file.name}: could not read valid JSON.`);
  }
}

function filePath(file: File) {
  return file.webkitRelativePath || file.name;
}

function outputFile(folder: readonly File[], name: string) {
  return folder.find(file => filePath(file).split('/').length <= 2 && file.name === name);
}

function resolveFolderTemplate(calibration: File, reference: string, folder: readonly File[]) {
  let path = calibration.webkitRelativePath ?? '';
  if (!path) {
    const matches = folder.filter(file => file.webkitRelativePath && file.name === calibration.name
      && file.size === calibration.size && file.lastModified === calibration.lastModified);
    if (matches.length === 1) path = matches[0].webkitRelativePath;
  }
  const segments = path.split('/').slice(0, -1);
  if (!segments.length || reference.startsWith('/') || /^[a-z]:/i.test(reference)) return;
  for (const segment of reference.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length <= 1) return;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return folder.find(file => filePath(file) === segments.join('/'));
}

async function readTemplate(file: File): Promise<RinkTemplate> {
  const rink = await readJson(file);
  if (!isRinkTemplate(rink)) throw new Error(`${file.name}: invalid rink template.`);
  return rink;
}

async function gameRink(files: GameFiles, folder: readonly File[]): Promise<RinkTemplate> {
  if (files.rink) return readTemplate(files.rink);
  const calibration = files.calibration ?? outputFile(folder, 'calibration.json');
  if (!calibration) return allyPally;
  const config = await readJson(calibration);
  if (!config || typeof config !== 'object' || !('rink_template' in config)
    || typeof config.rink_template !== 'string' || !config.rink_template.trim()) {
    throw new Error(`${calibration.name}: missing rink_template reference. Choose a rink template file manually.`);
  }
  const reference = config.rink_template.replaceAll('\\', '/');
  const relative = resolveFolderTemplate(calibration, reference, folder);
  if (relative) return readTemplate(relative);
  const bundled = templates.get(reference.split('/').at(-1) ?? '');
  if (bundled) return bundled;
  throw new Error(`${calibration.name}: cannot find ${config.rink_template}. Choose the matching rink template file manually.`);
}

export async function loadLocalGame(files: GameFiles): Promise<GameData> {
  const folder = files.folder ?? [];
  const positionsFile = files.positions ?? outputFile(folder, 'positions.json');
  const summaryFile = files.summary ?? outputFile(folder, 'summary.json');
  if (!positionsFile || !summaryFile) {
    throw new Error('Choose the pipeline output folder containing positions.json and summary.json, or choose both files manually.');
  }
  const [rows, summary, rink] = await Promise.all([readJson(positionsFile), readJson(summaryFile), gameRink(files, folder)]);
  if (!isPositions(rows)) {
    throw new Error(`${positionsFile.name}: invalid positions at ${isPositions.errors?.[0]?.instancePath || '/'}.`);
  }
  if (!isSummary(summary)) {
    throw new Error(`${summaryFile.name}: invalid summary at ${isSummary.errors?.[0]?.instancePath || '/'}.`);
  }
  for (const period of summary.periods) {
    for (const { grid } of Object.values(period.heatmaps)) {
      if (grid.some(row => row.length !== grid[0].length)) {
        throw new Error(`${summaryFile.name}: heatmap rows must have equal lengths.`);
      }
    }
  }
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
    videoId: `${files.video.name}:${files.video.size}`,
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

export async function loadReplacementGame(files: GameFiles, canReplace: () => boolean): Promise<GameData | null> {
  const next = await loadLocalGame(files);
  if (canReplace()) return next;
  next.dispose();
  return null;
}
