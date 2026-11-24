// Where the excitatory inputs sit: spread over the dendrites in proportion to membrane area (spines are
// where most excitatory synapses are). The count drawn is far below the real number (thousands).
import type { Cell } from './model';

export interface SynapseSite {
  comp: number;
  /** Point on the dendrite surface (um, morphology coordinates) and the outward direction. */
  pos: [number, number, number];
  dir: [number, number, number];
}

export const N_SYNAPSES = 300;

function rand(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

export function buildSynapses(cell: Cell): SynapseSite[] {
  const r = rand(17);
  const dend = cell.comps.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === 'dend');
  const total = dend.reduce((s, d) => s + d.c.area, 0);
  const out: SynapseSite[] = [];
  for (let k = 0; k < N_SYNAPSES; k++) {
    let u = r() * total;
    let pick = dend[0];
    for (const d of dend) { u -= d.c.area; if (u <= 0) { pick = d; break; } }
    let dir: [number, number, number] = [r() - 0.5, r() - 0.5, r() - 0.5];
    const l = Math.hypot(...dir);
    dir = [dir[0] / l, dir[1] / l, dir[2] / l];
    out.push({ comp: pick.i, pos: pick.c.pos, dir });
  }
  return out;
}
