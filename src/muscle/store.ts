// View switches for the muscle page.
import { useSyncExternalStore } from 'react';

export interface MuscleView {
  /** Open a wedge of the fibre to show the inside. */
  cut: boolean;
  /** Both ends held: the model's own condition (no shortening). Off: the fibre is drawn shortening (illustrative). */
  isometric: boolean;
  panelOpen: boolean;
}

let state: MuscleView = { cut: true, isometric: false, panelOpen: true };
const listeners = new Set<() => void>();

export const getMuscleView = () => state;
export function setMuscleView(p: Partial<MuscleView>) {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}
export function useMuscleView(): MuscleView {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state);
}
