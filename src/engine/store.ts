// A tiny shared store for state that both the DOM interface and the 3D scenes read.
import { useSyncExternalStore } from 'react';

export interface SimState {
  playing: boolean;
  showInhibitor: boolean;
  /** Whether the info panel is open; the 3D view shifts left so nothing is hidden behind it. */
  panelOpen: boolean;
  /** Draw only one in ten insulin granules, to see past them. */
  sparseGranules: boolean;
  /** Cut the cell open with a plane, like a textbook drawing, to show the inside. */
  cutaway: boolean;
  /** Organelles and particles move (real time). */
  motion: boolean;
}

let state: SimState = { playing: true, showInhibitor: false, panelOpen: true, sparseGranules: false, cutaway: true, motion: true };
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
  scaleBar: HTMLDivElement | null;
  scaleLabel: HTMLSpanElement | null;
  notice: HTMLDivElement | null;
  ladderMarker: HTMLDivElement | null;
  ladderLabel: HTMLSpanElement | null;
} = { scaleBar: null, scaleLabel: null, notice: null, ladderMarker: null, ladderLabel: null };
