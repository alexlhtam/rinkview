import { create } from 'zustand';

type Filter = 'A' | 'B' | 'none' | 'referee';

interface ViewSettings {
  filters: Record<Filter, boolean>;
  trails: number;
  ids: boolean;
  setTrails(seconds: number): void;
  toggleFilter(filter: Filter): void;
  toggleIds(): void;
}

export const useViewSettings = create<ViewSettings>((set) => ({
  filters: { A: true, B: true, none: true, referee: true },
  trails: 2,
  ids: false,
  setTrails: trails => set({ trails }),
  toggleFilter: filter => set(state => ({ filters: { ...state.filters, [filter]: !state.filters[filter] } })),
  toggleIds: () => set(state => ({ ids: !state.ids })),
}));
