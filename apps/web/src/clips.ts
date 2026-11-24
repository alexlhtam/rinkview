export interface Clip {
  start_s: number;
  end_s: number;
  title: string;
  note: string;
}

export function makeClip(start: number | null, end: number | null, title: string, note: string): Clip | undefined {
  if (start === null || end === null || start >= end || !title.trim()) return undefined;
  return { start_s: start, end_s: end, title: title.trim(), note: note.trim() };
}
