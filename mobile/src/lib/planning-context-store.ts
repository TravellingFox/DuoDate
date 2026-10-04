import { create } from 'zustand';
import type { PlanningContextKey } from '@/lib/planning-context';

interface PlanningContextState {
  selectedContextKey: PlanningContextKey | null;
  setSelectedContextKey: (key: PlanningContextKey | null) => void;
}

export const usePlanningContextStore = create<PlanningContextState>((set) => ({
  selectedContextKey: null,
  setSelectedContextKey: (selectedContextKey) => set({ selectedContextKey }),
}));
