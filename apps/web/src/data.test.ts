import { describe, expect, it } from 'vitest';
import summary from '../../../shared/schemas/summary.example.json';
import positions from '../../../shared/schemas/positions.example.json';
import custom from '../../../shared/rink_templates/ally-pally-estimate.json';
import { loadLocalGame } from './data';

function json(name: string, value: unknown, path?: string, lastModified = 0) {
  const file = new File([JSON.stringify(value)], name, { lastModified });
  if (path) Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

const video = new File(['sample'], 'period.mp4');
const folder = [
  json('positions.json', positions, 'p1/positions.json'),
  json('summary.json', summary, 'p1/summary.json'),
];

describe('local pipeline outputs', () => {
  it('opens the output folder with the bundled sample rink by default', async () => {
    const game = await loadLocalGame({ video, folder });
    expect(game.rink.id).toBe('ally-pally-estimate');
    expect(await game.positions.readWindow(0, 1)).toEqual([{ time: 0, positions }]);
    game.dispose();
  });

  it('resolves the template named by the calibration instead of the default', async () => {
    const calibration = json('period.json', { rink_template: '../rink_templates/iihf.json' });
    const game = await loadLocalGame({ video, folder, calibration });
    expect(game.rink.id).toBe('iihf');
    game.dispose();
  });

  it('resolves a custom template relative to a calibration in the selected folder', async () => {
    const calibration = json('calibration.json', { rink_template: 'templates/home.json' }, 'p1/calibration.json');
    const rink = json('home.json', { ...custom, id: 'home-rink' }, 'p1/templates/home.json');
    const game = await loadLocalGame({ video, folder: [...folder, calibration, rink] });
    expect(game.rink.id).toBe('home-rink');
    game.dispose();
  });

  it('keeps the folder path when the same calibration is also selected manually', async () => {
    const config = { rink_template: '../templates/home.json' };
    const other = json('period.json', config, 'p1/other/camera/period.json', 123);
    const inFolder = json('period.json', config, 'p1/camera/period.json', 456);
    const calibration = json('period.json', config, undefined, 456);
    const rink = json('home.json', { ...custom, id: 'home-rink' }, 'p1/templates/home.json');
    const game = await loadLocalGame({ video, folder: [...folder, other, inFolder, rink], calibration });
    expect(game.rink.id).toBe('home-rink');
    game.dispose();
  });

  it('requires a manual override when a referenced custom template is unavailable', async () => {
    const calibration = json('period.json', { rink_template: '../rink_templates/home.json' });
    await expect(loadLocalGame({ video, folder, calibration })).rejects.toThrow('matching rink template file manually');
    const game = await loadLocalGame({ video, folder, calibration, rink: json('home.json', custom) });
    expect(game.rink.id).toBe(custom.id);
    game.dispose();
  });

  it('reports a folder without both export files', async () => {
    await expect(loadLocalGame({ video, folder: [folder[0]] })).rejects.toThrow('positions.json and summary.json');
  });
});
