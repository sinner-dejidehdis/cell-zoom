// Headless check of the neuron model: Mainen & Sejnowski 1996 Fig. 1d protocol (0.2 nA into the soma
// of the L5 pyramid from 5 ms for 900 ms). Expect repetitive bursting. node --experimental-strip-types tools/neuron-check.mjs [nA]
import { Neuron, DT } from '../src/sim/neuron/model.ts';
const nrn = new Neuron();
console.log('compartments', nrn.n, 'axon end', nrn.cell.axonEnd);
const amp = +(process.argv[2] ?? 0.2);
const spikes = [], axonSpikes = [];
let above = false, aboveAx = false;
const t0 = performance.now();
for (let k = 0; k * DT < 1000; k++) {
  const t = k * DT;
  nrn.iclamp = t >= 5 && t < 905 ? amp : 0;
  nrn.step();
  const v = nrn.v[0];
  if (!above && v > -20) spikes.push(+t.toFixed(1));
  above = v > -20;
  const va = nrn.v[nrn.cell.axonEnd];
  if (!aboveAx && va > -20) axonSpikes.push(+t.toFixed(1));
  aboveAx = va > -20;
}
console.log('wall ms', (performance.now() - t0).toFixed(0), 'for 1000 ms');
console.log('soma spikes', spikes.length, spikes.slice(0, 40).join(' '));
console.log('axon-end spikes', axonSpikes.length, 'first delay', (axonSpikes[0] - spikes[0]).toFixed(2), 'ms');
const isi = spikes.slice(1).map((s, i) => +(s - spikes[i]).toFixed(1));
console.log('ISIs', isi.slice(0, 40).join(' '));
