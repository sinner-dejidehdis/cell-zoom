// Which level the camera is in, where that level sits in its parent, and which child is in focus.
// React renders from this; the camera controller changes it.
import { useSyncExternalStore } from 'react';
import { LEVELS, pathTo, type LevelId } from '../content/levels';
import { defaultAnchor, type Anchor } from './anchors';

export interface WorldState {
  level: LevelId;
  /** For each level on the current path below the root: where it sits in its parent. */
  entries: Partial<Record<LevelId, Anchor>>;
  /** The child of the current level nearest the orbit target, if any is close enough. */
  focus: Anchor | null;
  /** Whether the focused child is close enough to be drawn in full detail. */
  revealed: boolean;
  /** Child instance under the pointer, for highlighting. */
  hover: number;
}

let state: WorldState | null = null;
const listeners = new Set<() => void>();

export function initWorld(level: LevelId): void {
  const entries: WorldState['entries'] = {};
  for (const id of pathTo(level)) {
    const parent = LEVELS[id].parent;
    if (parent) entries[id] = defaultAnchor(parent);
  }
  state = { level, entries, focus: null, revealed: false, hover: -1 };
}

export function getWorld(): WorldState {
  if (!state) throw new Error('world not initialised');
  return state;
}

export function setWorld(patch: Partial<WorldState>): void {
  state = { ...getWorld(), ...patch };
  listeners.forEach((l) => l());
}

export function useWorld(): WorldState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getWorld,
  );
}
