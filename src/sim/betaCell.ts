// A human beta cell, in numbers: membrane potential, Ca2+, glycolysis and insulin granule fusion.
//
// Electrical activity, Ca2+ and glycolysis: Riz, Braun & Pedersen (2014) PLoS Comput Biol 10:e1003389,
// ported line by line from the authors' XPPAUT file for the metabolism simulations (PLoSCompBiol_Fig6.ode,
// https://www.dei.unipd.it/~pedersen/). Parameter values are those of that file.
//
// Granule fusion: the highly Ca2+-sensitive pool (HCSP) of the authors' human exocytosis file
// (exoc-human-new.ode; Pedersen et al. 2011, Prog Biophys Mol Biol, doi 10.1016/j.pbiomolbio.2011.07.012):
// fusion rate per granule = Fmax * Ca^3 / (Kf^3 + Ca^3). That file uses its own submembrane Ca2+; here the
// submembrane Ca2+ of the 2014 model drives it (our combination, not the authors'). That file keeps the pool
// constant; here it is depleted by fusion and refilled at a constant rate (our addition, see REFILL_PER_S).
//
// Units: time ms, voltage mV, currents pA/pF, Ca2+ uM, metabolites mM.

export interface Params {
  /** Extracellular glucose, mM. */
  glucose: number;
  /** K(ATP) conductance scale (gKATP-hat), nS/pF. */
  gkatp: number;
}

export const DEFAULT_PARAMS: Params = { glucose: 10, gkatp: 0.05 };

// ---- constants from PLoSCompBiol_Fig6.ode ----
const VNa = 70, VCa = 65, VK = -75;
const gleak = 0.015, vleak = -30;
const taumkv0 = 2, Vmkv = 0, nmkv = -10, gkv = 0.2;
const taumBK = 2, VmBK = 0, nmBK = -10, basal = 20, gBK = 0.01;
const gNa = 0.4, VmNa = -18, nmNa = -5, VhNa = -42, nhNa = 6, tauhNa = 2;
const gCaL = 0.14, VmCaL = -25, nmCaL = -6, tauhCaL = 20;
const gCaPQ = 0.17, VmCaPQ = -10, nmCaPQ = -6;
const gCaT = 0.05, VmCaT = -40, nmCaT = -4, VhCaT = -64, nhCaT = 8, tauhCaT = 7;
const gSK = 0.02, kSK = 0.57, nSK = 5.2;
// (hERG: gHERG = 0 in this file, so it is left out.)
const Cm = 10;
const f = 0.01, B = 0.1, Volc = 1.15e-12, Volm = 1e-13, alpha = 5.18e-15;
const Jsercamax = 0.06, Kserca = 0.27, Jpmcamax = 0.021, Kpmca = 0.5, Jleak = 0.94e-3, Jncx0 = 0.01867;
const KGPI = 0.3, KTPI = 0.045455;
const hGK = 1.7, Vgk_max = 0.0000556, KGK = 8;
const Kpfk = 4.0, Xpfk = 0.01, hpfk = 2.5, Vpfk_max = 0.000556, hact = 1.0, hx = 2.5, alphaG = 5.0;
const Kfba = 0.005, Vfba_max = 0.000139, Pfba = 0.5, Qfba = 0.275;
const Kgapdh = 0.005, Vgapdh_max = 0.00139;
const kA = 0.0001;

// ---- granule fusion (exoc-human-new.ode) ----
const Fmax = 1; // per second
const Kf = 2; // uM
const nfu = 3;
export const HCSP_SIZE = 400; // granules, HCSP(0) in that file
/** Refill of the pool when empty, granules per second. Illustrative: we take 20 per minute. (An estimate of
 * 5-40 granules per cell per minute for mouse beta cells is quoted in the literature; we have not traced it
 * to its original measurement.) */
export const REFILL_PER_S = 20 / 60;

const boltz = (v: number, vh: number, n: number) => 1 / (1 + Math.exp((v - vh) / n));

export interface State {
  t: number; // ms
  v: number;
  mkv: number;
  mBK: number;
  hNa: number;
  hCaL: number;
  hCaT: number;
  Cam: number;
  Cac: number;
  G6P_F6P: number;
  FBP: number;
  DHAP_G3P: number;
  a: number;
  /** Granules in the releasable pool (continuous; the scene draws whole granules). */
  pool: number;
  /** Granules released so far. */
  released: number;
}

export function initialState(): State {
  return {
    t: 0, v: -62, mkv: 0, mBK: 0, hNa: 1, hCaL: 1, hCaT: 0.4,
    Cam: 0.038, Cac: 0.036, G6P_F6P: 3.54, FBP: 0.0005, DHAP_G3P: 0.0022, a: 0.22,
    pool: HCSP_SIZE, released: 0,
  };
}

export interface Derived {
  /** Open fraction of K(ATP) channels relative to fully open: 1/(1+a). */
  katpOpen: number;
  iKatp: number;
  iCa: number;
  vgk: number;
  vgapdh: number;
  /** Fusion rate, granules per second. */
  fusionRate: number;
}

function rates(s: State, p: Params) {
  const v = s.v;
  const mkvinf = boltz(v, Vmkv, nmkv);
  const taumkv = taumkv0 + 10 * Math.exp(Math.min(Math.log(3), (-20 - v) / 6));
  const mBKinf = boltz(v, VmBK, nmBK);
  const hNainf = boltz(v, VhNa, nhNa);
  const mNainf = boltz(v, VmNa, nmNa);
  const mCaLinf = boltz(v, VmCaL, nmCaL);
  const hCaLinf = Math.max(0, Math.min(1, 1 + (mCaLinf * (v - VCa)) / 57));
  const mCaPQinf = boltz(v, VmCaPQ, nmCaPQ);
  const mCaTinf = boltz(v, VmCaT, nmCaT);
  const hCaTinf = boltz(v, VhCaT, nhCaT);

  const Ileak = gleak * (v - vleak);
  const IKv = gkv * s.mkv * (v - VK);
  const ICaL = gCaL * mCaLinf * s.hCaL * (v - VCa);
  const ICaPQ = gCaPQ * mCaPQinf * (v - VCa);
  const ICaT = gCaT * mCaTinf * s.hCaT * (v - VCa);
  const ICa = ICaL + ICaPQ + ICaT;
  const IBK = gBK * (-ICa + basal) * s.mBK * (v - VK);
  const INa = gNa * mNainf * s.hNa * (v - VNa);
  const katpOpen = 1 / (1 + s.a);
  const IKatp = p.gkatp * katpOpen * (v - VK);
  const camn = Math.pow(Math.max(s.Cam, 0), nSK);
  const ISK = gSK * (camn / (Math.pow(kSK, nSK) + camn)) * (v - VK);

  const JCa = (-alpha * ICa * Cm) / Volm;
  const Jserca = (Jsercamax * s.Cac * s.Cac) / (Kserca * Kserca + s.Cac * s.Cac);
  const Jpmca = (Jpmcamax * s.Cam) / (Kpmca + s.Cam);
  const Jncx = Jncx0 * s.Cam;
  const L = Jpmca + Jncx;

  const F6P = (s.G6P_F6P * KGPI) / (1 + KGPI);
  const G3P = (s.DHAP_G3P * KTPI) / (1 + KTPI);
  const DHAP = s.DHAP_G3P - G3P;
  const glc = p.glucose;
  const vgk = (Vgk_max * Math.pow(glc, hGK)) / (Math.pow(KGK, hGK) + Math.pow(glc, hGK));
  const hF = hpfk - ((hpfk - hact) * s.FBP) / (Kfba + s.FBP);
  const x = Math.pow(F6P / Kpfk, hF);
  const fx = Math.pow(s.FBP / Xpfk, hx);
  const vpfk = (Vpfk_max * x) / (x + (1 + fx) / (1 + Math.pow(alphaG, hF) * fx));
  const vfba = (Vfba_max * (s.FBP / Kfba - (G3P * DHAP) / (Pfba * Qfba * Kfba))) / (1 + s.FBP / Kfba + DHAP / Qfba + (G3P * DHAP) / (Pfba * Qfba));
  const vgapdh = (Vgapdh_max * G3P) / (Kgapdh + G3P);

  const cam3 = Math.pow(Math.max(s.Cam, 0), nfu);
  const fusionPerGranule = (Fmax * cam3) / (Math.pow(Kf, nfu) + cam3); // per second

  return {
    inf: { mkv: mkvinf, mBK: mBKinf, hNa: hNainf, hCaL: hCaLinf, hCaT: hCaTinf },
    tau: { mkv: taumkv, mBK: taumBK, hNa: tauhNa, hCaL: tauhCaL, hCaT: tauhCaT },
    dv: -(ISK + IBK + IKv + INa + ICaL + ICaPQ + ICaT + IKatp + Ileak),
    dCam: f * (JCa - (B * (s.Cam - s.Cac) * Volc) / Volm - (L * Volc) / Volm),
    dCac: f * (B * (s.Cam - s.Cac) - Jserca + Jleak),
    dG6P_F6P: vgk - vpfk,
    dFBP: vpfk - vfba,
    dDHAP_G3P: 2 * vfba - vgapdh,
    da: vgapdh - kA * s.a,
    derived: { katpOpen, iKatp: IKatp, iCa: ICa, vgk, vgapdh, fusionRate: fusionPerGranule * s.pool } as Derived,
    fusionPerGranule,
  };
}

const GATES = ['mkv', 'mBK', 'hNa', 'hCaL', 'hCaT'] as const;

/**
 * Advance by dt ms. Gates use the exponential (Rush-Larsen) update, which stays stable at steps far longer
 * than their time constants; the rest uses forward Euler. dt <= 0.05 ms keeps spikes within ~1 mV of a
 * fine-step reference (checked in tools/sim-check.mjs).
 */
export function step(s: State, p: Params, dt: number): Derived {
  const r = rates(s, p);
  for (const g of GATES) s[g] = r.inf[g] + (s[g] - r.inf[g]) * Math.exp(-dt / r.tau[g]);
  s.v += dt * r.dv;
  s.Cam += dt * r.dCam;
  s.Cac += dt * r.dCac;
  s.G6P_F6P += dt * r.dG6P_F6P;
  s.FBP += dt * r.dFBP;
  s.DHAP_G3P += dt * r.dDHAP_G3P;
  s.a += dt * r.da;
  const sec = dt / 1000;
  const fused = r.fusionPerGranule * s.pool * sec;
  s.pool += REFILL_PER_S * (1 - s.pool / HCSP_SIZE) * sec - fused;
  s.released += fused;
  s.t += dt;
  return r.derived;
}
