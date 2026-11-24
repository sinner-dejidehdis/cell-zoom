// Geometry of the pyramidal neuron, in micrometres, built from the same reconstruction the model uses.
// Coordinates are relative to the soma centre; the scene rotates them so the apical dendrite points up (+Y).
// Every vertex carries `aComp`, the model compartment it belongs to, so the shader can colour it by that
// compartment's membrane potential.
import * as THREE from 'three';
import { buildCell } from '../sim/neuron/model';
import { buildSynapses } from '../sim/neuron/synapses';

export const CELL = buildCell();
export const SITES = buildSynapses(CELL);
export const NC = CELL.comps.length;
const C = CELL.somaCenter;

/** Rotation that turns the apical direction into +Y. */
export const Q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...CELL.apical), new THREE.Vector3(0, 1, 0));

/** Axon diameter (um) as in the model: equivalent soma diameter / 10. */
const SOMA = { diam: 25, L: 35 };
export const AXON_D = Math.sqrt((Math.PI * SOMA.diam * SOMA.L) / (4 * Math.PI)) / 10;
/** Myelin outer diameter for a g-ratio (axon / fibre diameter) of about 0.7: illustrative, typical value. */
export const MYELIN_D = AXON_D / 0.7;

// ---- voltage texture and shader patch ----

export const voltTex = new THREE.DataTexture(new Float32Array(NC).fill(-70), NC, 1, THREE.RedFormat, THREE.FloatType);
voltTex.minFilter = voltTex.magFilter = THREE.NearestFilter;
voltTex.needsUpdate = true;
const voltU = { value: voltTex };

const VOLT_GLSL = `
vec3 voltColor(float v) {
  float t = clamp((v + 80.0) / 110.0, 0.0, 1.0);
  vec3 c = mix(vec3(0.10, 0.22, 0.50), vec3(0.20, 0.62, 0.78), smoothstep(0.0, 0.35, t));
  c = mix(c, vec3(1.0, 0.72, 0.22), smoothstep(0.30, 0.70, t));
  return mix(c, vec3(1.0, 1.0, 0.88), smoothstep(0.70, 1.0, t));
}`;

/** Colour a material by the membrane potential of each vertex's compartment (`amount` 0-1 of the colour). */
export function voltMaterial<T extends THREE.Material>(m: T, key: string, amount = 1, glow = true): T {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uVolt = voltU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aComp;\nuniform sampler2D uVolt;\nvarying float vVolt;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVolt = texelFetch(uVolt, ivec2(int(aComp + 0.5), 0), 0).r;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vVolt;\n' + VOLT_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, voltColor(vVolt), ${amount.toFixed(2)});`);
    if (glow) {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\ntotalEmissiveRadiance += ${amount.toFixed(2)} * voltColor(vVolt) * smoothstep(-66.0, -10.0, vVolt) * 0.9;`,
      );
    }
  };
  m.customProgramCacheKey = () => 'volt-' + key;
  return m;
}

/** Give every vertex of a geometry the same compartment. */
export function withComp(g: THREE.BufferGeometry, comp: number): THREE.BufferGeometry {
  g.setAttribute('aComp', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(comp), 1));
  return g;
}

// ---- tubes ----

interface Ring { p: THREE.Vector3; r: number; c: number }

class TubeBuilder {
  pos: number[] = [];
  nor: number[] = [];
  comp: number[] = [];
  idx: number[] = [];
  lines: number[] = [];
  lineComp: number[] = [];
  constructor(private radial = 6) {}

  add(rings: Ring[], line = true) {
    const pts = rings.filter((r, i) => i === 0 || r.p.distanceTo(rings[i - 1].p) > 1e-3 || r.c !== rings[i - 1].c);
    if (pts.length < 2) return;
    const n = this.radial;
    let normal = new THREE.Vector3();
    const base = this.pos.length / 3;
    pts.forEach((ring, i) => {
      const a = pts[Math.max(0, i - 1)].p, b = pts[Math.min(pts.length - 1, i + 1)].p;
      const t = b.clone().sub(a);
      if (t.lengthSq() < 1e-12) t.set(0, 1, 0);
      t.normalize();
      if (i === 0) {
        normal = Math.abs(t.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      }
      normal.addScaledVector(t, -normal.dot(t)).normalize();
      const bin = t.clone().cross(normal);
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2;
        const d = normal.clone().multiplyScalar(Math.cos(ang)).addScaledVector(bin, Math.sin(ang));
        this.pos.push(ring.p.x + d.x * ring.r, ring.p.y + d.y * ring.r, ring.p.z + d.z * ring.r);
        this.nor.push(d.x, d.y, d.z);
        this.comp.push(ring.c);
      }
      if (i > 0) {
        const r0 = base + (i - 1) * n, r1 = base + i * n;
        for (let k = 0; k < n; k++) {
          const k1 = (k + 1) % n;
          this.idx.push(r0 + k, r1 + k, r1 + k1, r0 + k, r1 + k1, r0 + k1);
        }
        if (line) {
          this.lines.push(pts[i - 1].p.x, pts[i - 1].p.y, pts[i - 1].p.z, ring.p.x, ring.p.y, ring.p.z);
          this.lineComp.push(pts[i - 1].c, ring.c);
        }
      }
    });
  }

  mesh(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aComp', new THREE.Float32BufferAttribute(this.comp, 1));
    g.setIndex(this.idx);
    return g;
  }

  skeleton(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.lines, 3));
    g.setAttribute('aComp', new THREE.Float32BufferAttribute(this.lineComp, 1));
    return g;
  }
}

/** Compartments of each section, in order along it. */
const secComps = new Map<string, number[]>();
CELL.comps.forEach((c, i) => {
  if (!secComps.has(c.section)) secComps.set(c.section, []);
  secComps.get(c.section)!.push(i);
});

function sectionArc(name: string) {
  const s = CELL.sections.find((x) => x.name === name)!;
  const p = s.pts.map((q) => new THREE.Vector3(q[0] - C[0], q[1] - C[1], q[2] - C[2]));
  const arc = [0];
  for (let i = 1; i < p.length; i++) arc.push(arc[i - 1] + p[i].distanceTo(p[i - 1]));
  return { s, p, arc, L: arc[arc.length - 1] };
}

/** Centre point, radius and direction of a dendritic section at fraction x along it. */
export function sectionAt(name: string, x: number): { p: THREE.Vector3; r: number; axis: THREE.Vector3 } {
  const { s, p, arc, L } = sectionArc(name);
  const u = x * L;
  let i = 1;
  while (i < p.length - 1 && arc[i] < u) i++;
  const f = (u - arc[i - 1]) / (arc[i] - arc[i - 1] || 1);
  return {
    p: p[i - 1].clone().lerp(p[i], f),
    r: (s.pts[i - 1][3] + (s.pts[i][3] - s.pts[i - 1][3]) * f) / 2,
    axis: p[i].clone().sub(p[i - 1]).normalize(),
  };
}

export function buildDendrites() {
  const tb = new TubeBuilder(6);
  for (const s of CELL.sections) {
    const { p, arc, L } = sectionArc(s.name);
    const comps = secComps.get(s.name)!;
    const rings: Ring[] = p.map((q, i) => ({
      p: q,
      r: s.pts[i][3] / 2,
      c: comps[Math.min(comps.length - 1, Math.floor((arc[i] / (L || 1)) * comps.length))],
    }));
    // Primary dendrites: run the tube on into the soma, which has no 3-D points of its own.
    if (s.parent === 'soma') rings.unshift({ p: new THREE.Vector3(), r: rings[0].r, c: rings[0].c });
    tb.add(rings);
  }
  return { mesh: tb.mesh(), skeleton: tb.skeleton() };
}

const AXON_SEG: Record<string, number> = { hill: 2, iseg: 3, myelin: 20, node: 1 };

/** The axon as modelled (hillock, initial segment, 5 internodes with nodes), plus illustrative terminals. */
export function buildAxon() {
  const dir = new THREE.Vector3(...CELL.axonDir);
  const axon = new TubeBuilder(8);
  const myelin = new TubeBuilder(12);
  const d = AXON_D;
  let hillK = 0;
  const rings: Ring[] = [{ p: new THREE.Vector3(), r: 2 * d, c: 0 }];
  CELL.comps.forEach((c, i) => {
    if (c.kind === 'soma' || c.kind === 'dend') return;
    const L = AXON_SEG[c.kind];
    const mid = new THREE.Vector3(...c.pos);
    const a = mid.clone().addScaledVector(dir, -L / 2), b = mid.clone().addScaledVector(dir, L / 2);
    let r0 = d / 2, r1 = d / 2;
    if (c.kind === 'hill') { r0 = (4 * d - 3 * d * (hillK / 5)) / 2; r1 = (4 * d - 3 * d * ((hillK + 1) / 5)) / 2; hillK++; }
    if (c.kind === 'node') r0 = r1 = (0.75 * d) / 2;
    rings.push({ p: a, r: r0, c: i }, { p: b, r: r1, c: i });
    if (c.kind === 'myelin') {
      // Each internode is 5 compartments; leave a small gap at the nodes.
      const gapA = c.x < 0.2 ? 0.3 : 0, gapB = c.x > 0.8 ? 0.3 : 0;
      const pa = a.clone().addScaledVector(dir, gapA), pb = b.clone().addScaledVector(dir, -gapB);
      const R = MYELIN_D / 2;
      const ends: Ring[] = [];
      if (gapA) ends.push({ p: pa.clone().addScaledVector(dir, -0.001), r: d / 2, c: i });
      ends.push({ p: pa, r: R, c: i }, { p: pb, r: R, c: i });
      if (gapB) ends.push({ p: pb.clone().addScaledVector(dir, 0.001), r: d / 2, c: i });
      myelin.add(ends, false);
    }
  });
  axon.add(rings);

  // Terminal branches past the end of the modelled axon: not in the model, drawn so the output is visible.
  // They take the voltage of the last node.
  const end = rings[rings.length - 1].p;
  const terminals = new TubeBuilder(5);
  const boutons: THREE.Vector3[] = [];
  const side = new THREE.Vector3(1, 0, 0).cross(dir).normalize();
  for (let k = 0; k < 6; k++) {
    const ang = (k / 6) * Math.PI * 2 + 0.4;
    const off = side.clone().applyAxisAngle(dir, ang);
    const len = 14 + 9 * ((k * 37) % 5) / 5;
    const mid = end.clone().addScaledVector(dir, len * 0.5).addScaledVector(off, len * 0.25);
    const tip = end.clone().addScaledVector(dir, len * 0.8).addScaledVector(off, len * 0.6);
    terminals.add([
      { p: end, r: 0.25, c: CELL.axonEnd },
      { p: mid, r: 0.2, c: CELL.axonEnd },
      { p: tip, r: 0.2, c: CELL.axonEnd },
    ]);
    boutons.push(tip);
  }
  return { axon: axon.mesh(), axonLines: axon.skeleton(), myelin: myelin.mesh(), terminals: terminals.mesh(), terminalLines: terminals.skeleton(), boutons };
}

// ---- synapses ----

/** Where each input bouton is drawn: on the dendrite surface, pointing outwards. */
export const BOUTONS = SITES.map((s) => {
  const c = CELL.comps[s.comp];
  const at = sectionAt(c.section, c.x);
  const dir = new THREE.Vector3(...s.dir);
  // Keep the direction perpendicular to the dendrite so the bouton sits beside it.
  dir.addScaledVector(at.axis, -dir.dot(at.axis)).normalize();
  return { comp: s.comp, center: at.p, r: at.r, axis: at.axis, dir };
});

/** The synapse shown in detail: one on the apical trunk, 60-300 um from the soma. */
export const FEATURED = (() => {
  const ap = new THREE.Vector3(...CELL.apical);
  let best = 0, bestR = -1;
  BOUTONS.forEach((b, i) => {
    const along = b.center.dot(ap);
    if (along > 60 && along < 300 && b.r > bestR) { bestR = b.r; best = i; }
  });
  return best;
})();

/** Featured synapse dimensions (um), local frame: y = 0 on the dendrite surface, +y outwards. */
export const SYNAPSE = {
  neckR: 0.05, neckTop: 0.75,
  headR: 0.25, headY: 0.95, capR: 0.15,
  psdT: 0.025,
  cleft: 0.02,
  boutonR: 0.42, boutonCap: 0.17,
  vesicleR: 0.02,
};
export const S_TOP_HEAD = SYNAPSE.headY + Math.sqrt(SYNAPSE.headR ** 2 - SYNAPSE.capR ** 2);
export const S_BOUTON_BOTTOM = S_TOP_HEAD + SYNAPSE.cleft;
export const S_BOUTON_CENTER = S_BOUTON_BOTTOM + Math.sqrt(SYNAPSE.boutonR ** 2 - SYNAPSE.boutonCap ** 2);

/** World-space placement of the featured synapse. */
export function featuredFrame() {
  const b = BOUTONS[FEATURED];
  const origin = b.center.clone().addScaledVector(b.dir, b.r);
  const local = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.dir);
  const dirW = b.dir.clone().applyQuaternion(Q);
  const axisW = b.axis.clone().applyQuaternion(Q);
  const centerW = origin.clone().addScaledVector(b.dir, S_TOP_HEAD).applyQuaternion(Q);
  return { origin, local, dirW, axisW, centerW };
}
