import { useSyncExternalStore } from 'react';

export type NeuronPreset = 'overview' | 'soma' | 'synapse';
export interface NeuronView { panelOpen: boolean; preset: NeuronPreset | null }

let state: NeuronView = { panelOpen: true, preset: null };
const listeners = new Set<() => void>();
export const getNeuronView = () => state;
export function setNeuronView(p: Partial<NeuronView>) {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}
export function useNeuronView(): NeuronView {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state);
}
