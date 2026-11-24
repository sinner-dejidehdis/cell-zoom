// Runs the pyramidal-neuron model off the main thread; posts voltages for every compartment each frame.
import { DT, Neuron, type Synapse } from './model';
import { buildSynapses, type SynapseSite } from './synapses';

export type ToNeuron =
  | { type: 'set'; speed?: number; running?: boolean; iclamp?: number; rate?: number }
  | { type: 'reset' }
  /** Make one synapse release a quantum now (for the close-up of a single synapse). */
  | { type: 'release'; index: number };

export interface NeuronSnapshot {
  t: number; // ms
  v: Float32Array; // per compartment, mV
  cai: Float32Array; // per compartment, mM
  /** Releases since the last snapshot: [synapse index, model time]. */
  releases: [number, number][];
  /** Spikes that reached the end of the axon since the last snapshot (model time). */
  outSpikes: number[];
  /** Soma and a distal apical compartment, sampled for the trace: [t, vSoma, vApical]. */
  samples: [number, number, number][];
  iclamp: number;
  rate: number;
  speed: number;
  running: boolean;
  /** Firing rate at the soma over the last 500 ms of model time, Hz. */
  firing: number;
}

const nrn = new Neuron();
const sites: SynapseSite[] = buildSynapses(nrn.cell);
const syns: Synapse[] = sites.map((s) => ({ comp: s.comp, a: 0, b: 0 }));
nrn.syn.push(...syns);
const P_RELEASE = 0.5; // illustrative; cortical synapses span roughly 0.1-0.9

let speed = 0.05, running = true, rate = 15, iclamp = 0;
let releases: [number, number][] = [];
let outSpikes: number[] = [];
let samples: [number, number, number][] = [];
let nextSample = 0;
let somaSpikes: number[] = [];
let aboveSoma = false, aboveAxon = false;
const apicalProbe = (() => {
  // The apical compartment about 400 um from the soma along the apical direction.
  let best = 0, bestErr = Infinity;
  nrn.cell.comps.forEach((c, i) => {
    const along = c.pos[0] * nrn.cell.apical[0] + c.pos[1] * nrn.cell.apical[1] + c.pos[2] * nrn.cell.apical[2];
    if (c.kind === 'dend' && Math.abs(along - 400) < bestErr) { bestErr = Math.abs(along - 400); best = i; }
  });
  return best;
})();

function advance(ms: number) {
  const end = nrn.t + ms;
  // Presynaptic spikes: each synapse's input axon fires as a Poisson process at `rate`.
  const pSpike = rate * DT * 1e-3;
  while (nrn.t < end) {
    if (pSpike > 0) {
      for (let i = 0; i < syns.length; i++) {
        if (Math.random() < pSpike && Math.random() < P_RELEASE) {
          nrn.release(syns[i]);
          releases.push([i, nrn.t]);
        }
      }
    }
    nrn.iclamp = iclamp;
    nrn.step();
    const vs = nrn.v[0], va = nrn.v[nrn.cell.axonEnd];
    if (!aboveSoma && vs > -20) somaSpikes.push(nrn.t);
    aboveSoma = vs > -20;
    if (!aboveAxon && va > -20) outSpikes.push(nrn.t);
    aboveAxon = va > -20;
    if (nrn.t >= nextSample) {
      samples.push([nrn.t, vs, nrn.v[apicalProbe]]);
      nextSample = nrn.t + 0.1;
    }
  }
}

self.onmessage = (e: MessageEvent<ToNeuron>) => {
  const m = e.data;
  if (m.type === 'set') {
    if (m.speed !== undefined) speed = m.speed;
    if (m.running !== undefined) running = m.running;
    if (m.iclamp !== undefined) iclamp = m.iclamp;
    if (m.rate !== undefined) rate = m.rate;
  } else if (m.type === 'release') {
    nrn.release(syns[m.index]);
    releases.push([m.index, nrn.t]);
  } else {
    nrn.reset();
    nextSample = 0;
    somaSpikes = [];
    samples = [];
  }
};

let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const wall = Math.min(now - last, 100);
  last = now;
  if (running) advance(wall * speed);
  somaSpikes = somaSpikes.filter((t) => t > nrn.t - 500);
  const msg: NeuronSnapshot = {
    t: nrn.t,
    v: Float32Array.from(nrn.v),
    cai: Float32Array.from(nrn.cai),
    releases, outSpikes, samples,
    iclamp, rate, speed, running,
    firing: somaSpikes.length * 2,
  };
  releases = []; outSpikes = []; samples = [];
  (self as unknown as Worker).postMessage(msg, [msg.v.buffer, msg.cai.buffer]);
}, 16);
