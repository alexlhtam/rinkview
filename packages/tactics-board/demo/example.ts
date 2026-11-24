import { createClip } from '../src'
import type { Annotation, TeachingClip } from '../src'

export function exampleClip(): TeachingClip {
  const clip = createClip()
  const mark = (id: string, kind: Annotation['kind'], points_m: Annotation['points_m'],
    style: Annotation['style']): Annotation => ({
    id, kind, t_from: clip.start_t, t_to: clip.end_t, points_m, style,
  })
  return {
    ...clip,
    title: 'Weak-side coverage',
    notes: 'F3 stays above the puck. Weak-side D closes the middle before the pass.',
    tags: ['D-zone coverage', 'Weak side'],
    added_players_json: [
      { id: 'right-defence', team: 'A', role: 'player', x_m: 12.7, y_m: 7.9 },
      { id: 'high-forward', team: 'A', role: 'player', x_m: 3.2, y_m: -5.5 },
      { id: 'left-defence', team: 'A', role: 'player', x_m: 17.2, y_m: -5.8 },
      { id: 'goalie', team: 'A', role: 'goalie', x_m: 22.7, y_m: .2 },
      { id: 'wing', team: 'B', role: 'player', x_m: 19.7, y_m: 7.1 },
      { id: 'centre', team: 'B', role: 'player', x_m: 7.7, y_m: 1.7 },
      { id: 'low-wing', team: 'B', role: 'player', x_m: 13.1, y_m: -8.9 },
    ],
    annotations_json: [
      mark('zone', 'zone', [[11.4, 3.7], [19.9, 3.7], [19.9, -2.2], [11.4, -2.2]], { color: '#08785d', shape: 'rectangle' }),
      mark('slot', 'label', [[12.1, 1.4]], { color: '#08785d', text: 'Protect the slot' }),
      mark('route', 'arrow', [[2.4, -4.5], [3.8, .4]], { color: '#124eaa' }),
      mark('lane', 'pass', [[18.7, 6.7], [9.1, 2.3]], { color: '#ab284c' }),
      mark('f3-halo', 'spotlight', [[3.2, -5.5]], { color: '#124eaa' }),
      mark('f3-name', 'label', [[.1, -6.8]], { color: '#124eaa', text: 'F3' }),
      mark('gap', 'measure', [[17.2, -5.8], [22.7, .2]], { color: '#94600b' }),
    ],
  }
}
