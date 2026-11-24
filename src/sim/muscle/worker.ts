// Runs the skeletal-muscle model (Shorten et al. 2007) off the main thread.
// The page asks for stimuli; the worker posts a snapshot about every frame.
import { IDX, N, REST, STIM_AMPLITUDE, STIM_WIDTH, rates } from './shorten2007';
import { Ros2 } from './ros2';

export type ToMuscle =
  | { type: 'twitch' }
  | { type: 'train'; on: boolean; hz?: number }
  | { type: 'set'; speed?: number; running?: boolean }
  | { type: 'reset' };

/** One trace sample: model time (ms), membrane potential (mV), myoplasmic Ca2+ (uM), force (0-1). */
export type Sample = [number, number, number, number];

export interface MuscleSnapshot {
  t: number; // ms
  v: number; // surface membrane, mV
  vT: number; // T-tubule membrane, mV
  ca: number; // myoplasm (bulk), uM
  caSR: number; // SR, free, uM
  /** Force relative to a 100 Hz tetanus from rest (A2 above its resting value). */
  force: number;
  /** Phosphate in the myoplasm, mM: rises with use and slows cross-bridges (the model's fatigue). */
  p: number;
  speed: number;
  running: boolean;
  train: boolean;
  hz: number;
  /** True while the model is held at rest (see the panel text). */
  idle: boolean;
  samples: Sample[];
}

const DT = 0.02; // ms; checked against LSODA (tools/muscle-check.mjs)
const SAMPLE_MS = 0.25;
const IDLE_AFTER_MS = 1500;
const A2_REST = REST[IDX.razumova__A_2];
const A2_TETANUS = 2.303; // peak A2 in a 100 Hz, 500 ms train from REST (tools/muscle-check.mjs)

let y = Float64Array.from(REST);
let t = 0;
let stim = 0;
let speed = 0.05;
let running = true;
let train = false;
let hz = 50;
let trainStart = 0;
let pulseAt: number | null = null; // pending single twitch
let lastPulse = -1e9;
let samples: Sample[] = [];
let nextSample = 0;
const solver = new Ros2(N, (tt, yy, dy) => rates(tt, yy, dy, stim), 10);

function stimulusAt(tt: number): number {
  if (pulseAt !== null && tt >= pulseAt && tt < pulseAt + STIM_WIDTH) return STIM_AMPLITUDE;
  if (train) {
    const period = 1000 / hz;
    if ((tt - trainStart) % period < STIM_WIDTH) return STIM_AMPLITUDE;
  }
  return 0;
}

function advance(ms: number) {
  const end = t + ms;
  while (t < end) {
    const s = stimulusAt(t);
    if (s !== stim) {
      stim = s;
      solver.invalidate();
    }
    if (s) lastPulse = t;
    if (pulseAt !== null && t >= pulseAt + STIM_WIDTH) pulseAt = null;
    const idle = !train && pulseAt === null && t - lastPulse > IDLE_AFTER_MS;
    if (!idle) solver.step(t, y, DT);
    t += DT;
    if (t >= nextSample) {
      samples.push([t, y[IDX.wal_environment__vS], y[IDX.razumova__Ca_2], force()]);
      nextSample = t + SAMPLE_MS;
    }
  }
}

function force() {
  return (y[IDX.razumova__A_2] - A2_REST) / (A2_TETANUS - A2_REST);
}

function post() {
  const msg: MuscleSnapshot = {
    t,
    v: y[IDX.wal_environment__vS],
    vT: y[IDX.wal_environment__vT],
    ca: y[IDX.razumova__Ca_2],
    caSR: y[IDX.razumova__Ca_SR2],
    force: force(),
    p: y[IDX.razumova__P] ,
    speed,
    running,
    train,
    hz,
    idle: !train && pulseAt === null && t - lastPulse > IDLE_AFTER_MS,
    samples,
  };
  samples = [];
  (self as unknown as Worker).postMessage(msg);
}

self.onmessage = (e: MessageEvent<ToMuscle>) => {
  const m = e.data;
  if (m.type === 'twitch') pulseAt = t + 0.1;
  else if (m.type === 'train') {
    if (m.hz) hz = m.hz;
    if (m.on && !train) trainStart = t + 0.1;
    train = m.on;
  } else if (m.type === 'set') {
    if (m.speed !== undefined) speed = m.speed;
    if (m.running !== undefined) running = m.running;
  } else if (m.type === 'reset') {
    y = Float64Array.from(REST);
    t = 0;
    train = false;
    pulseAt = null;
    lastPulse = -1e9;
    nextSample = 0;
    samples = [];
    solver.invalidate();
  }
};

let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const wall = Math.min(now - last, 100);
  last = now;
  if (running) advance(wall * speed);
  post();
}, 16);
