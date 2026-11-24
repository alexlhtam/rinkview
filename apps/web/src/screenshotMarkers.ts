import type { Role, Team } from './contracts';
import type { Point } from './screenshotCalibration';

export interface Marker {
  id: string;
  foot: Point;
  role: Role;
  team: Team;
  bbox?: [number, number, number, number];
  rink?: Point;
}

export type MarkerAction =
  | { type: 'replace'; markers: Marker[] }
  | { type: 'add'; marker: Marker }
  | { type: 'delete'; id: string }
  | { type: 'edit'; id: string; patch: Partial<Omit<Marker, 'id'>> };

export function editMarkers(markers: Marker[], action: MarkerAction): Marker[] {
  switch (action.type) {
    case 'replace': return action.markers;
    case 'add': return [...markers, action.marker];
    case 'delete': return markers.filter(marker => marker.id !== action.id);
    case 'edit': return markers.map(marker => marker.id === action.id ? { ...marker, ...action.patch } : marker);
  }
}
