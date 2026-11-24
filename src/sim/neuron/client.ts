import NeuronWorker from './worker?worker&inline';
import type { NeuronSnapshot, ToNeuron } from './worker';

export const TRACE_MS = 300;

export const neuron: {
  latest: NeuronSnapshot | null;
  trace: [number, number, number][];
  /** Recent releases and output spikes, kept for the animation (model time). */
  releases: [number, number][];
  outSpikes: number[];
} = { latest: null, trace: [], releases: [], outSpikes: [] };

let worker: Worker | null = null;

export function startNeuron(): void {
  if (worker) return;
  (window as unknown as { __neuron: unknown }).__neuron = neuron;
  worker = new NeuronWorker();
  worker.onmessage = (e: MessageEvent<NeuronSnapshot>) => {
    const s = e.data;
    if (neuron.latest && s.t < neuron.latest.t) { neuron.trace = []; neuron.releases = []; neuron.outSpikes = []; }
    neuron.latest = s;
    neuron.trace.push(...s.samples);
    neuron.releases.push(...s.releases);
    neuron.outSpikes.push(...s.outSpikes);
    const cut = s.t - TRACE_MS;
    neuron.trace = neuron.trace.filter((x) => x[0] >= cut);
    neuron.releases = neuron.releases.filter((x) => x[1] >= s.t - 20);
    neuron.outSpikes = neuron.outSpikes.filter((x) => x >= s.t - 20);
  };
}

export function sendNeuron(m: ToNeuron): void {
  worker?.postMessage(m);
}
