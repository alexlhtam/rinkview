import { expect, it } from 'vitest';
import { editMarkers } from './screenshotMarkers';
import type { Marker } from './screenshotMarkers';

it('adds, drags, relabels and deletes only the chosen marker', () => {
  const detected: Marker = { id: 'detected', foot: [23, 48], team: 'B', role: 'player', bbox: [13, 20, 33, 49], rink: [2, 4] };
  const manual: Marker = { id: 'manual', foot: [37, 49], team: 'none', role: 'player' };
  const initial = editMarkers([], { type: 'replace', markers: [detected] });
  const added = editMarkers(initial, { type: 'add', marker: manual });
  const moved = editMarkers(added, { type: 'edit', id: 'detected', patch: { foot: [31, 51], bbox: undefined, rink: undefined } });
  const relabelled = editMarkers(moved, { type: 'edit', id: 'detected', patch: { team: 'A', role: 'goalie' } });
  expect(relabelled).toEqual([{ ...detected, foot: [31, 51], team: 'A', role: 'goalie', bbox: undefined, rink: undefined }, manual]);
  expect(editMarkers(relabelled, { type: 'delete', id: 'detected' })).toEqual([manual]);
  expect(initial[0]).toBe(detected);
});
