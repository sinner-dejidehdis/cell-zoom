// Run the beta-cell model headless and print a summary per glucose level.
// node --experimental-strip-types tools/sim-check.mjs
import { initialState, step, DEFAULT_PARAMS } from '../src/sim/betaCell.ts';

function run(glucose, minutes, dt) {
  const s = initialState();
  const p = { ...DEFAULT_PARAMS, glucose };
  let spikes = 0, above = false, vmax = -999, vmin = 999, camMax = 0;
  const perMin = [];
  let lastMinSpikes = 0, lastRel = 0;
  const total = minutes * 60000;
  while (s.t < total) {
    step(s, p, dt);
    if (!above && s.v > -20) { spikes++; above = true; }
    if (above && s.v < -40) above = false;
    if (s.t > total - 60000) { vmax = Math.max(vmax, s.v); vmin = Math.min(vmin, s.v); camMax = Math.max(camMax, s.Cam); }
    if (Math.abs(s.t % 60000) < dt / 2 || s.t % 60000 < dt) {
      perMin.push(`${spikes - lastMinSpikes}sp/${(s.released - lastRel).toFixed(1)}g`);
      lastMinSpikes = spikes; lastRel = s.released;
    }
    if (!Number.isFinite(s.v)) { console.log('blew up at', s.t); break; }
  }
  return { glucose, a: s.a.toFixed(3), Cam: s.Cam.toFixed(3), camMax: camMax.toFixed(3), v: `${vmin.toFixed(1)}..${vmax.toFixed(1)}`, pool: s.pool.toFixed(0), released: s.released.toFixed(1), perMin: perMin.join(' ') };
}

const dt = +(process.argv[2] || 0.05);
const minutes = +(process.argv[3] || 7);
for (const g of (process.argv[4] || '3,6,10,15').split(',').map(Number)) console.log(JSON.stringify(run(g, minutes, dt)));
