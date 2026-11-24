// A multi-compartment model of a layer 5 pyramidal neuron, following Mainen & Sejnowski (1996)
// (ModelDB 2488: demofig1.hoc, na/kv/km/kca/ca/cad.mod, morphology cells/j4a.hoc), re-implemented here:
// same morphology, compartments (nseg = L/50 + 1), axon, spine correction, channel kinetics and densities.
// The solver is NEURON's default scheme in spirit: exponential Euler for the gates, backward Euler for
// the voltages (Hines elimination on the tree), dt = 0.025 ms. Units: mV, ms, nA, nF, uS, mM.
//
// Added by us (not in the paper): AMPA-type synapses on the dendrites driven by presynaptic spike trains,
// so that the page can show synaptic input. Their parameters are illustrative.
import MORPH from '../../content/neuron-j4a.json' with { type: 'json' };

type Pt = [number, number, number, number];
interface Section { name: string; pts: Pt[]; parent: string; parentX: number }

export const CELSIUS = 37;
const TADJ = Math.pow(2.3, (CELSIUS - 23) / 10);
const RA = 150; // ohm cm
const CM = 0.75; // uF/cm2
const CM_MYELIN = 0.04;
const G_PAS = 1 / 30000; // S/cm2
const G_PAS_NODE = 0.02;
const E_PAS = -70;
const EK = -90, ENA = 60, ECA = 140;
const VSHIFT_NA = -5;
const SPINE_AREA = 0.83, SPINE_DENS = 1; // um2, per um2 (Jack et al., as in the original code)
export const DT = 0.025;

/** Channel densities, pS/um2 (demofig1.hoc). */
const D = { naDend: 20, naNode: 30000, kvAxon: 2000, kvSoma: 200, ca: 0.3, km: 0.1, kca: 3 };

export type Kind = 'soma' | 'dend' | 'hill' | 'iseg' | 'myelin' | 'node';

export interface Compartment {
  kind: Kind;
  parent: number; // -1 for the soma
  /** Axial conductance to the parent, uS. */
  ga: number;
  area: number; // um2 (with the spine correction)
  /** Centre position (um), for drawing; axon compartments are placed along a straight line. */
  pos: [number, number, number];
  section: string;
  /** Position along its section, 0-1, of the compartment's centre. */
  x: number;
}

// ---- geometry: compartments from 3-D points ----

interface Geo { L: number; area: (a: number, b: number) => number; ri: (a: number, b: number) => number; at: (s: number) => [number, number, number] }

/** Integrals over a section given by 3-D points: lateral area and axial resistance between arc lengths a and b. */
function geoFromPoints(pts: Pt[]): Geo {
  const s = [0];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0, z0] = pts[i - 1], [x1, y1, z1] = pts[i];
    s.push(s[i - 1] + Math.hypot(x1 - x0, y1 - y0, z1 - z0));
  }
  const L = s[s.length - 1];
  const integrate = (a: number, b: number, f: (d0: number, d1: number, len: number) => number) => {
    let sum = 0;
    for (let i = 1; i < pts.length; i++) {
      const lo = Math.max(a, s[i - 1]), hi = Math.min(b, s[i]);
      if (hi <= lo) continue;
      const seg = s[i] - s[i - 1] || 1e-9;
      const d = (u: number) => pts[i - 1][3] + (pts[i][3] - pts[i - 1][3]) * ((u - s[i - 1]) / seg);
      sum += f(d(lo), d(hi), hi - lo);
    }
    return sum;
  };
  return {
    L,
    // Frustum side area (NEURON uses the same formula, including the slant).
    area: (a, b) => integrate(a, b, (d0, d1, len) => (Math.PI * (d0 + d1) / 2) * Math.sqrt(len * len + ((d1 - d0) / 2) ** 2)),
    // Resistance of a frustum: 4 Ra len / (pi d0 d1), in ohm (um and ohm cm: x 1e4).
    ri: (a, b) => integrate(a, b, (d0, d1, len) => (4 * RA * len) / (Math.PI * d0 * d1) * 1e4),
    at: (u) => {
      for (let i = 1; i < pts.length; i++) {
        if (u <= s[i] || i === pts.length - 1) {
          const f = (u - s[i - 1]) / (s[i] - s[i - 1] || 1);
          return [0, 1, 2].map((k) => pts[i - 1][k] + (pts[i][k] - pts[i - 1][k]) * f) as [number, number, number];
        }
      }
      return [pts[0][0], pts[0][1], pts[0][2]];
    },
  };
}

function cylinder(L: number, d0: number, d1: number, from: [number, number, number], dir: [number, number, number]): Geo {
  const pts: Pt[] = [[...from, d0] as Pt, [from[0] + dir[0] * L, from[1] + dir[1] * L, from[2] + dir[2] * L, d1]];
  return geoFromPoints(pts);
}

export interface Cell {
  comps: Compartment[];
  /** Index of the soma compartment (0) and of the last axon node (where output spikes are read). */
  soma: number;
  axonEnd: number;
  /** Unit vector from the soma along the apical dendrite (morphology coordinates). */
  apical: [number, number, number];
  /** Unit vector of the drawn axon. */
  axonDir: [number, number, number];
  sections: Section[];
  /** The morphology file has no 3-D points for the soma; its centre is taken as the mean of the primary
   * dendrites' first points. Compartment positions are relative to it; section points are not. */
  somaCenter: [number, number, number];
}

export function buildCell(): Cell {
  const sections = (MORPH as unknown as { sections: Section[] }).sections;
  const soma = (MORPH as { soma: { diam: number; L: number } }).soma;
  const comps: Compartment[] = [];
  const somaArea = Math.PI * soma.diam * soma.L;
  // Soma: one compartment, a cylinder L 35 x diam 25 um; children attach at its centre.
  comps.push({ kind: 'soma', parent: -1, ga: 0, area: somaArea, pos: [0, 0, 0], section: 'soma', x: 0.5 });
  const somaRiHalf = ((4 * RA * (soma.L / 2)) / (Math.PI * soma.diam * soma.diam)) * 1e4;
  void somaRiHalf; // children attach at soma(0.5), the compartment centre: no soma resistance in between

  // Dendrites in an order where every parent comes first.
  const byName = new Map(sections.map((s) => [s.name, s]));
  const done = new Map<string, { first: number; nseg: number; geo: Geo; halfRi: number[] }>();
  const order: Section[] = [];
  const visit = (s: Section) => {
    if (order.includes(s)) return;
    if (s.parent !== 'soma') visit(byName.get(s.parent)!);
    order.push(s);
  };
  sections.forEach(visit);
  const prim = sections.filter((x) => x.parent === 'soma');
  const somaCenter = [0, 1, 2].map((k) => prim.reduce((a, x) => a + x.pts[0][k], 0) / prim.length) as [number, number, number];
  const rel = (p: [number, number, number]): [number, number, number] => [p[0] - somaCenter[0], p[1] - somaCenter[1], p[2] - somaCenter[2]];
  for (const s of order) {
    const geo = geoFromPoints(s.pts);
    const nseg = Math.floor(geo.L / 50) + 1;
    const segL = geo.L / nseg;
    // Spines (dendrites only): area x F, axial resistance unchanged (L x F^2/3, diam x F^1/3).
    const totalArea = geo.area(0, geo.L);
    const F = (geo.L * SPINE_AREA * SPINE_DENS + totalArea) / totalArea;
    const first = comps.length;
    const halfRi: number[] = [];
    for (let k = 0; k < nseg; k++) {
      const a = k * segL, b = (k + 1) * segL, m = (a + b) / 2;
      halfRi.push(geo.ri(a, m), geo.ri(m, b));
      let parent: number, ri: number;
      if (k > 0) {
        parent = comps.length - 1;
        ri = halfRi[2 * k - 1] + halfRi[2 * k];
      } else if (s.parent === 'soma') {
        parent = 0;
        ri = halfRi[0];
      } else {
        const p = done.get(s.parent)!;
        const kp = Math.min(p.nseg - 1, Math.floor(s.parentX * p.nseg - 1e-9));
        parent = p.first + kp;
        // From the parent's compartment centre to the connection point, then to this compartment's centre.
        const pSegL = p.geo.L / p.nseg;
        const xConn = s.parentX * p.geo.L, mid = (kp + 0.5) * pSegL;
        ri = (xConn > mid ? p.geo.ri(mid, xConn) : p.geo.ri(xConn, mid)) + halfRi[0];
      }
      comps.push({ kind: 'dend', parent, ga: 1e6 / ri, area: geo.area(a, b) * F, pos: rel(geo.at(m)), section: s.name, x: (k + 0.5) / nseg });
    }
    done.set(s.name, { first, nseg, geo, halfRi });
  }

  // Apical direction: towards the far end of the longest path from the soma.
  let far = comps[1];
  for (const c of comps) if (Math.hypot(...c.pos) > Math.hypot(...far.pos)) far = c;
  const fl = Math.hypot(...far.pos);
  const apical: [number, number, number] = [far.pos[0] / fl, far.pos[1] / fl, far.pos[2] / fl];
  const axonDir: [number, number, number] = [-apical[0], -apical[1], -apical[2]];

  // Axon (demofig1.hoc, after Mainen et al. 1995): hillock 10 um tapering 4*d -> d, initial segment 15 um,
  // then 5 x (myelin 100 um + node 1 um at 0.75 d), with d = equivalent soma diameter / 10.
  const equivDiam = Math.sqrt(somaArea / (4 * Math.PI));
  const d = equivDiam / 10;
  let start: [number, number, number] = [axonDir[0] * soma.diam / 2, axonDir[1] * soma.diam / 2, axonDir[2] * soma.diam / 2];
  let parentIdx = 0;
  let parentHalfRi = 0;
  const addAxon = (kind: Kind, name: string, L: number, d0: number, d1: number, nseg: number) => {
    const geo = cylinder(L, d0, d1, start, axonDir);
    const segL = L / nseg;
    for (let k = 0; k < nseg; k++) {
      const a = k * segL, b = a + segL, m = (a + b) / 2;
      const ri = parentHalfRi + geo.ri(a, m);
      comps.push({ kind, parent: parentIdx, ga: 1e6 / ri, area: geo.area(a, b), pos: geo.at(m), section: name, x: (k + 0.5) / nseg });
      parentIdx = comps.length - 1;
      parentHalfRi = geo.ri(m, b);
    }
    start = geo.at(L);
  };
  addAxon('hill', 'hill', 10, 4 * d, d, 5);
  addAxon('iseg', 'iseg', 15, d, d, 5);
  for (let i = 0; i < 5; i++) {
    addAxon('myelin', `myelin[${i}]`, 100, d, d, 5);
    addAxon('node', `node[${i}]`, 1, 0.75 * d, 0.75 * d, 1);
  }
  return { comps, soma: 0, axonEnd: comps.length - 1, apical, axonDir, sections, somaCenter };
}

// ---- channels ----

function efun(z: number) {
  return Math.abs(z) < 1e-4 ? 1 - z / 2 : z / (Math.exp(z) - 1);
}

/** Voltage tables, as NEURON's TABLE statements do (vmin -120 .. vmax 100), with linear interpolation. */
const VMIN = -120, VMAX = 100, NT = 2201;
function table(f: (v: number) => number[]) {
  const n = f(0).length;
  const t = new Float64Array(NT * n);
  for (let i = 0; i < NT; i++) t.set(f(VMIN + ((VMAX - VMIN) * i) / (NT - 1)), i * n);
  return { t, n };
}
const NA = table((v) => {
  const vm = v + VSHIFT_NA;
  let a = 0.182 * 9 * efun((-35 - vm) / 9), b = 0.124 * 9 * efun((vm + 35) / 9);
  const mtau = 1 / TADJ / (a + b), minf = a / (a + b);
  a = 0.024 * 5 * efun((-50 - vm) / 5);
  b = 0.0091 * 5 * efun((vm + 75) / 5);
  return [minf, mtau, 1 / (1 + Math.exp((vm + 65) / 6.2)), 1 / TADJ / (a + b)];
});
const KV = table((v) => {
  const a = 0.02 * 9 * efun(-(v - 25) / 9), b = 0.002 * 9 * efun((v - 25) / 9);
  return [a / (a + b), 1 / TADJ / (a + b)];
});
const KM = table((v) => {
  const a = 0.001 * 9 * efun(-(v + 30) / 9), b = 0.001 * 9 * efun((v + 30) / 9);
  return [a / (a + b), 1 / TADJ / (a + b)];
});
const CA = table((v) => {
  let a = 0.209 * efun(-(27 + v) / 3.8), b = 0.94 * Math.exp((-75 - v) / 17);
  const minf = a / (a + b), mtau = 1 / TADJ / (a + b);
  a = 0.000457 * Math.exp((-13 - v) / 50);
  b = 0.0065 / (Math.exp((-v - 15) / 28) + 1);
  return [minf, mtau, a / (a + b), 1 / TADJ / (a + b)];
});
function look(tb: { t: Float64Array; n: number }, v: number, out: number[]) {
  let u = ((Math.min(VMAX, Math.max(VMIN, v)) - VMIN) / (VMAX - VMIN)) * (NT - 1);
  const i = Math.min(NT - 2, Math.floor(u));
  u -= i;
  for (let k = 0; k < tb.n; k++) out[k] = tb.t[i * tb.n + k] * (1 - u) + tb.t[(i + 1) * tb.n + k] * u;
}

// ---- state and stepping ----

export interface Synapse {
  comp: number;
  /** Conductance (uS) and its two state variables for a difference of exponentials. */
  a: number;
  b: number;
}

export const SYN = { tauRise: 0.2, tauDecay: 2, gQuantum: 0.001, erev: 0 }; // ms, ms, uS (1 nS), mV

export class Neuron {
  readonly cell: Cell;
  readonly n: number;
  v: Float64Array;
  cai: Float64Array;
  private m: Float64Array; private h: Float64Array; private nkv: Float64Array; private nkm: Float64Array;
  private nkca: Float64Array; private mca: Float64Array; private hca: Float64Array;
  private gna: Float64Array; private gkv: Float64Array; private gkm: Float64Array; private gkca: Float64Array; private gca: Float64Array;
  private gpas: Float64Array; private cap: Float64Array; private hasCa: Uint8Array;
  private d: Float64Array; private rhs: Float64Array; private parent: Int32Array; private ga: Float64Array;
  readonly syn: Synapse[] = [];
  /** Current injected at the soma, nA. */
  iclamp = 0;
  t = 0;

  constructor(cell = buildCell()) {
    this.cell = cell;
    const n = (this.n = cell.comps.length);
    const f = () => new Float64Array(n);
    this.v = f(); this.cai = f(); this.m = f(); this.h = f(); this.nkv = f(); this.nkm = f(); this.nkca = f(); this.mca = f(); this.hca = f();
    this.gna = f(); this.gkv = f(); this.gkm = f(); this.gkca = f(); this.gca = f(); this.gpas = f(); this.cap = f(); this.hasCa = new Uint8Array(n);
    this.d = f(); this.rhs = f(); this.parent = new Int32Array(n); this.ga = f();
    cell.comps.forEach((c, i) => {
      const A = c.area * 1e-6; // pS/um2 * um2 -> uS
      this.parent[i] = c.parent;
      this.ga[i] = c.ga;
      this.cap[i] = (c.kind === 'myelin' ? CM_MYELIN : CM) * c.area * 1e-5; // nF
      this.gpas[i] = (c.kind === 'node' ? G_PAS_NODE : G_PAS) * 1e4 * A; // S/cm2 -> pS/um2 (x1e4)
      const dendritic = c.kind === 'soma' || c.kind === 'dend';
      this.gna[i] = TADJ * A * (c.kind === 'hill' || c.kind === 'iseg' || c.kind === 'node' ? D.naNode : D.naDend);
      this.gkv[i] = TADJ * A * (c.kind === 'hill' || c.kind === 'iseg' ? D.kvAxon : c.kind === 'soma' ? D.kvSoma : 0);
      if (dendritic) {
        this.gkm[i] = TADJ * A * D.km;
        this.gkca[i] = TADJ * A * D.kca;
        this.gca[i] = TADJ * A * D.ca;
        this.hasCa[i] = 1;
      }
    });
    this.reset();
  }

  reset() {
    const t4 = [0, 0, 0, 0];
    this.t = 0;
    for (let i = 0; i < this.n; i++) {
      const v = (this.v[i] = -70);
      look(NA, v, t4); this.m[i] = t4[0]; this.h[i] = t4[2];
      look(KV, v, t4); this.nkv[i] = t4[0];
      look(KM, v, t4); this.nkm[i] = t4[0];
      look(CA, v, t4); this.mca[i] = t4[0]; this.hca[i] = t4[2];
      this.cai[i] = 1e-4;
      const a = 0.01 * this.cai[i];
      this.nkca[i] = a / (a + 0.02);
    }
    for (const s of this.syn) s.a = s.b = 0;
  }

  /** A presynaptic release at synapse s: one quantum of conductance. */
  release(s: Synapse, quanta = 1) {
    s.a += quanta * SYN.gQuantum;
    s.b += quanta * SYN.gQuantum;
  }

  step() {
    const { n, v, parent, ga, d, rhs } = this;
    const t4 = [0, 0, 0, 0];
    const dt = DT;
    // Gates: exponential Euler at the present voltage.
    for (let i = 0; i < n; i++) {
      const vi = v[i];
      if (this.gna[i]) {
        look(NA, vi, t4);
        this.m[i] = t4[0] + (this.m[i] - t4[0]) * Math.exp(-dt / t4[1]);
        this.h[i] = t4[2] + (this.h[i] - t4[2]) * Math.exp(-dt / t4[3]);
      }
      if (this.gkv[i]) {
        look(KV, vi, t4);
        this.nkv[i] = t4[0] + (this.nkv[i] - t4[0]) * Math.exp(-dt / t4[1]);
      }
      if (this.hasCa[i]) {
        look(KM, vi, t4);
        this.nkm[i] = t4[0] + (this.nkm[i] - t4[0]) * Math.exp(-dt / t4[1]);
        look(CA, vi, t4);
        this.mca[i] = t4[0] + (this.mca[i] - t4[0]) * Math.exp(-dt / t4[1]);
        this.hca[i] = t4[2] + (this.hca[i] - t4[2]) * Math.exp(-dt / t4[3]);
        const a = 0.01 * this.cai[i], tau = 1 / TADJ / (a + 0.02);
        this.nkca[i] = a / (a + 0.02) + (this.nkca[i] - a / (a + 0.02)) * Math.exp(-dt / tau);
      }
    }
    // Synaptic conductances (difference of exponentials, exact decay over dt).
    const ea = Math.exp(-dt / SYN.tauRise), eb = Math.exp(-dt / SYN.tauDecay);
    const norm = 1 / (Math.pow(SYN.tauRise / SYN.tauDecay, SYN.tauRise / (SYN.tauDecay - SYN.tauRise)) - Math.pow(SYN.tauRise / SYN.tauDecay, SYN.tauDecay / (SYN.tauDecay - SYN.tauRise)));
    // Linear system: (C/dt + g) V' - sum ga (Vnb' - V') = C/dt V + sum g E + I
    for (let i = 0; i < n; i++) {
      const gNa = this.gna[i] * this.m[i] ** 3 * this.h[i];
      const gK = this.gkv[i] * this.nkv[i] + this.gkm[i] * this.nkm[i] + this.gkca[i] * this.nkca[i];
      const gCa = this.gca[i] * this.mca[i] ** 2 * this.hca[i];
      const c = this.cap[i] / dt;
      d[i] = c + gNa + gK + gCa + this.gpas[i];
      rhs[i] = c * v[i] + gNa * ENA + gK * EK + gCa * ECA + this.gpas[i] * E_PAS;
    }
    for (const s of this.syn) {
      s.a *= ea; s.b *= eb;
      const g = (s.b - s.a) * norm;
      d[s.comp] += g;
      rhs[s.comp] += g * SYN.erev;
    }
    rhs[this.cell.soma] += this.iclamp;
    for (let i = 1; i < n; i++) {
      d[i] += ga[i];
      d[parent[i]] += ga[i];
    }
    // Hines elimination: children have larger indices than their parents.
    for (let i = n - 1; i >= 1; i--) {
      const p = parent[i], f = ga[i] / d[i];
      d[p] -= f * ga[i];
      rhs[p] += f * rhs[i];
    }
    v[0] = rhs[0] / d[0];
    for (let i = 1; i < n; i++) v[i] = (rhs[i] + ga[i] * v[parent[i]]) / d[i];
    // Calcium in a 0.1 um shell under the membrane (cad.mod): inward current only, 200 ms removal.
    for (let i = 0; i < n; i++) {
      if (!this.hasCa[i]) continue;
      const area = this.cell.comps[i].area;
      const ica = (this.gca[i] * this.mca[i] ** 2 * this.hca[i] * (v[i] - ECA)) / (area * 1e-8) * 1e-6; // nA / cm2 -> mA/cm2
      const drive = Math.max(0, (-10000 * ica) / (2 * 96485.309 * 0.1));
      // derivimplicit: ca' = drive + (cainf - ca)/taur
      this.cai[i] = (this.cai[i] + dt * (drive + 1e-4 / 200)) / (1 + dt / 200);
    }
    this.t += dt;
  }
}
