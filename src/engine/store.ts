// A tiny shared store for state that both the DOM interface and the 3D scenes read.
import { useSyncExternalStore } from 'react';

export interface SimState {
  playing: boolean;
  showInhibitor: boolean;
}

let state: SimState = { playing: true, showInhibitor: false };
const listeners = new Set<() => void>();

export function getSim(): SimState {
  return state;
}

export function setSim(patch: Partial<SimState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useSim(): SimState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

// DOM nodes the render loop writes to directly, so per-frame updates do not re-render React.
export const domRefs: {
  overlay: HTMLDivElement | null;
  scaleBar: HTMLDivElement | null;
  scaleLabel: HTMLSpanElement | null;
} = { overlay: null, scaleBar: null, scaleLabel: null };
