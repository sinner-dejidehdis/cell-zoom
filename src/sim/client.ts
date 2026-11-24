// The main thread's side of the simulation: starts the worker and keeps the latest snapshot and a trace.
import SimWorker from './worker?worker&inline';
import type { Bucket, Snapshot, ToWorker } from './worker';

export const TRACE_SECONDS = 60;

export const sim: { latest: Snapshot | null; trace: Bucket[] } = { latest: null, trace: [] };

let worker: Worker | null = null;

export function startSim(): void {
  if (worker) return;
  worker = new SimWorker();
  worker.onmessage = (e: MessageEvent<Snapshot>) => {
    const snap = e.data;
    if (sim.latest && snap.t < sim.latest.t) sim.trace = []; // reset
    sim.latest = snap;
    if (snap.buckets.length) {
      sim.trace.push(...snap.buckets);
      const cut = snap.t - TRACE_SECONDS;
      let i = 0;
      while (i < sim.trace.length && sim.trace[i].t < cut) i++;
      if (i) sim.trace.splice(0, i);
    }
  };
}

export function send(m: ToWorker): void {
  worker?.postMessage(m);
}
