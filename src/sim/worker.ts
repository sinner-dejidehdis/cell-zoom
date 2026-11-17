// Runs the beta-cell model off the main thread and posts a snapshot about every frame.
import { DEFAULT_PARAMS, initialState, step, type Params, type State } from './betaCell';

export type ToWorker =
  | { type: 'set'; glucose?: number; speed?: number; running?: boolean }
  | { type: 'reset' };

export interface Bucket {
  /** Sim time at the bucket's end, s. */
  t: number;
  vmin: number;
  vmax: number;
  cam: number;
}

export interface Snapshot {
  t: number; // s
  v: number;
  vmaxTick: number;
  cam: number;
  camMaxTick: number;
  cac: number;
  a: number;
  katpOpen: number;
  vgk: number;
  vgapdh: number;
  /** Granules per second, averaged over the last simulated second. */
  fusionRate: number;
  pool: number;
  released: number;
  glucose: number;
  speed: number;
  running: boolean;
  buckets: Bucket[];
}

const DT = 0.05; // ms; see betaCell.ts
const BUCKET_MS = 100;
const MAX_STEPS_PER_TICK = 40000;

let s: State = initialState();
const p: Params = { ...DEFAULT_PARAMS, glucose: 5 };
let speed = 10;
let running = true;
let last = performance.now();
let bucket = { start: 0, vmin: Infinity, vmax: -Infinity, camSum: 0, n: 0 };
const releasedHistory: { t: number; r: number }[] = [];

function settle(ms: number) {
  const end = s.t + ms;
  while (s.t < end) step(s, p, DT);
  s.released = 0;
  bucket = { start: s.t, vmin: Infinity, vmax: -Infinity, camSum: 0, n: 0 };
}

function reset() {
  s = initialState();
  settle(60000); // a simulated minute at the current glucose, so the cell starts near its resting state
  s.pool = initialState().pool;
  releasedHistory.length = 0;
}
reset();

function tick() {
  const now = performance.now();
  const realMs = Math.min(now - last, 100);
  last = now;
  let vmaxTick = s.v;
  let camMaxTick = s.Cam;
  let katpOpen = 1 / (1 + s.a);
  let vgk = 0;
  let vgapdh = 0;
  const buckets: Bucket[] = [];
  if (running) {
    const steps = Math.min(Math.round((realMs * speed) / DT), MAX_STEPS_PER_TICK);
    for (let i = 0; i < steps; i++) {
      const d = step(s, p, DT);
      katpOpen = d.katpOpen;
      vgk = d.vgk;
      vgapdh = d.vgapdh;
      if (s.v > vmaxTick) vmaxTick = s.v;
      if (s.Cam > camMaxTick) camMaxTick = s.Cam;
      bucket.vmin = Math.min(bucket.vmin, s.v);
      bucket.vmax = Math.max(bucket.vmax, s.v);
      bucket.camSum += s.Cam;
      bucket.n++;
      if (s.t - bucket.start >= BUCKET_MS) {
        buckets.push({ t: s.t / 1000, vmin: bucket.vmin, vmax: bucket.vmax, cam: bucket.camSum / bucket.n });
        bucket = { start: s.t, vmin: Infinity, vmax: -Infinity, camSum: 0, n: 0 };
      }
    }
  }
  releasedHistory.push({ t: s.t, r: s.released });
  while (releasedHistory.length > 2 && releasedHistory[0].t < s.t - 1000) releasedHistory.shift();
  const h0 = releasedHistory[0];
  const span = (s.t - h0.t) / 1000;
  const snap: Snapshot = {
    t: s.t / 1000, v: s.v, vmaxTick, cam: s.Cam, camMaxTick, cac: s.Cac, a: s.a, katpOpen, vgk, vgapdh,
    fusionRate: span > 0 ? (s.released - h0.r) / span : 0,
    pool: s.pool, released: s.released, glucose: p.glucose, speed, running, buckets,
  };
  postMessage(snap);
}

setInterval(tick, 16);

onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'reset') reset();
  else {
    if (m.glucose !== undefined) p.glucose = m.glucose;
    if (m.speed !== undefined) speed = m.speed;
    if (m.running !== undefined) running = m.running;
  }
  last = performance.now();
};
