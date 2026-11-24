// The main thread's side of the muscle model: latest snapshot plus a trace of recent model time.
import MuscleWorker from './worker?worker&inline';
import type { MuscleSnapshot, Sample, ToMuscle } from './worker';

/** Trace window, ms of model time. */
export const TRACE_MS = 600;

export const muscle: { latest: MuscleSnapshot | null; trace: Sample[] } = { latest: null, trace: [] };

let worker: Worker | null = null;

export function startMuscle(): void {
  if (worker) return;
  (window as unknown as { __muscle: unknown }).__muscle = muscle; // for automated checks
  worker = new MuscleWorker();
  worker.onmessage = (e: MessageEvent<MuscleSnapshot>) => {
    const snap = e.data;
    if (muscle.latest && snap.t < muscle.latest.t) muscle.trace = [];
    muscle.latest = snap;
    muscle.trace.push(...snap.samples);
    const cut = snap.t - TRACE_MS;
    let i = 0;
    while (i < muscle.trace.length && muscle.trace[i][0] < cut) i++;
    if (i) muscle.trace.splice(0, i);
  };
}

export function sendMuscle(m: ToMuscle): void {
  worker?.postMessage(m);
}
