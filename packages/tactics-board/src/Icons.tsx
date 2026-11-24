const paths: Record<string, string> = {
  move: 'M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3m14-6 3 3-3 3',
  arrow: 'M4 20 20 4m-9 0h9v9',
  pass: 'M4 20l3-3m3-3 3-3m3-3 4-4m-8 0h8v8',
  line: 'M4 19 20 5M3 20h2M19 4h2',
  pen: 'M3 20c4 0 2-9 7-9s0 7 6 7c3 0 5-4 5-8',
  rectangle: 'M4 6h16v12H4z',
  polygon: 'm3 10 7-7 10 4 1 11-10 3z',
  text: 'M4 7V4h16v3M12 4v16m-4 0h8',
  spotlight: 'M8 3H3v5m13-5h5v5m0 8v5h-5m-8 0H3v-5m9 0a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  measure: 'M3 15 15 3l6 6L9 21zM6 12l2 2m1-5 2 2m1-5 2 2',
  player: 'M11 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM3 20a8 6 0 0 1 12-5m4-2v8m-4-4h8',
  ghost: 'M7 5a5 5 0 1 0 0 10m6-4 2-2-2-2m-6 2h8m2 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  undo: 'M9 5 4 10l5 5m-5-5h10a5 5 0 0 1 5 5v3',
  redo: 'm15 5 5 5-5 5m5-5H10a5 5 0 0 0-5 5v3',
  screen: 'M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6',
  image: 'M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4m-5-8h.01',
  upload: 'M12 16V4m-4 4 4-4 4 4M4 15v5h16v-5',
  download: 'M12 4v12m-4-4 4 4 4-4M4 16v4h16v-4',
  play: 'm8 5 12 7-12 7z',
  pause: 'M9 5v14m6-14v14',
  key: 'm12 4 8 8-8 8-8-8z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z',
  close: 'm6 6 12 12M18 6 6 18',
}

export function Icon({ name }: { name: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none"
    stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
    <path d={paths[name]} />
  </svg>
}
