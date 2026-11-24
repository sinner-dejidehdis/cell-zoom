// Headless check of the muscle model with the browser's stepper: twitch and 100 Hz tetanus.
// node --experimental-strip-types tools/muscle-check.mjs [dt] [jacEvery]
import { N, IDX, REST, rates, STIM_AMPLITUDE, STIM_WIDTH } from '../src/sim/muscle/shorten2007.ts';
import { Ros2 } from '../src/sim/muscle/ros2.ts';
const dt = +(process.argv[2] ?? 0.02), every = +(process.argv[3] ?? 10);
for (const [period, pulses, T] of [[1000, 1, 300], [50, 20, 1100], [10, 50, 800]]) {
  const y = Float64Array.from(REST);
  let stim = 0;
  const s = new Ros2(N, (t, yy, dy) => rates(t, yy, dy, stim), every);
  let peakA = 0, peakC = 0, peakV = -200, tA = 0;
  const t0 = performance.now();
  for (let t = 0; t < T; t += dt) {
    const on = (t % period) < STIM_WIDTH && t < pulses * period ? STIM_AMPLITUDE : 0;
    if (on !== stim) { stim = on; s.invalidate(); }
    s.step(t, y, dt);
    if (y[IDX.razumova__A_2] > peakA) { peakA = y[IDX.razumova__A_2]; tA = t; }
    peakC = Math.max(peakC, y[IDX.razumova__Ca_2]);
    peakV = Math.max(peakV, y[IDX.wal_environment__vS]);
  }
  console.log(`period ${period} n ${pulses}: peakA ${peakA.toFixed(4)} at ${tA.toFixed(1)} ms, peakCa ${peakC.toFixed(2)}, peakV ${peakV.toFixed(1)}; ${(performance.now() - t0).toFixed(0)} ms wall for ${T} ms`);
}
