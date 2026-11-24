export interface Activity {
  start: number;
  end: number;
  bins: number[];
}

export function activityBars({ start, end, bins }: Activity, duration: number) {
  if (!duration || !bins.length || end <= start || start >= duration) return [];
  const interval = (end - start) / bins.length;
  const visible = bins.flatMap((value, index) => {
    const from = start + interval * index;
    if (from >= duration) return [];
    const to = Math.min(duration, from + interval);
    return [{ value, left: 100 * from / duration, width: 100 * (to - from) / duration }];
  });
  const peak = Math.max(1, ...visible.map(bin => bin.value));
  return visible.map(({ value, left, width }) => ({ left, width, height: 100 * value / peak }));
}
