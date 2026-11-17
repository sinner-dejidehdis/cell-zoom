// Where each child level sits inside its parent, at true scale.
// An anchor's matrix maps the child's own coordinates into the parent's coordinates, so
//   parent-frame point = anchor.matrix * child-frame point.
// The camera crosses from one level to the next by applying this matrix (or its inverse) to itself,
// which is why the zoom can be continuous: nothing on screen moves at the moment of the switch.
import * as THREE from 'three';
import { CELL_PARAMS, LEVELS, childOf, type LevelId } from '../content/levels';
import { randomQuat, rng } from '../scenes/util';
import LAYOUT from '../content/cell-layout.json';
import { getData } from './data';

export interface Anchor {
  /** The level this anchor holds. */
  child: LevelId;
  /** Which instance in the parent (which mitochondrion, which ATP synthase). */
  index: number;
  matrix: THREE.Matrix4;
  /** The child's view centre, in parent coordinates. */
  center: THREE.Vector3;
  /** Parent units per child unit. */
  scale: number;
}

// ---- Cell layout (1 unit = 1 um) ----
// The membrane, nucleus, ER, Golgi and cilium come from tools/blender/build_cell.py, which also writes
// where they are (cell-layout.json). Mitochondria and granules are placed here, inside the membrane and
// clear of those structures.
export const NUCLEUS = new THREE.Vector3(...(LAYOUT.nucleus.center as [number, number, number]));
const NUCLEUS_RADII = new THREE.Vector3(...(LAYOUT.nucleus.radii as [number, number, number]));
const PLANES = LAYOUT.planes.map((p) => ({ n: new THREE.Vector3(...(p.n as [number, number, number])), d: p.d }));
const EXCLUSIONS = LAYOUT.exclusions.map((e) => ({ c: new THREE.Vector3(...(e.c as [number, number, number])), r: e.r }));
/** Space kept free under the membrane (its rounded edges and relief). */
const MEMBRANE_MARGIN = 0.25;

function insideCell(p: THREE.Vector3, reach: number): boolean {
  return PLANES.every(({ n, d }) => n.dot(p) <= d - reach - MEMBRANE_MARGIN);
}
/** Distance from p to the nearest membrane face (positive inside), and that face's outward normal. */
export function membraneDistance(p: THREE.Vector3): { d: number; n: THREE.Vector3 } {
  let best = { d: Infinity, n: PLANES[0].n };
  for (const { n, d } of PLANES) {
    const gap = d - n.dot(p);
    if (gap < best.d) best = { d: gap, n };
  }
  return best;
}

function clearOfNucleus(p: THREE.Vector3, reach: number): boolean {
  const q = p.clone().sub(NUCLEUS);
  const m = 0.08 + reach; // the envelope and its pores stand a little proud of the ellipsoid
  return new THREE.Vector3(q.x / (NUCLEUS_RADII.x + m), q.y / (NUCLEUS_RADII.y + m), q.z / (NUCLEUS_RADII.z + m)).length() > 1;
}

/**
 * The mitochondrion model (tools/blender) is 20 x 8 model units. Every mitochondrion is drawn at the same
 * size, 1.0 x 0.4 um, so one model unit is 50 nm (LEVELS.mitochondrion.metersPerUnit) and the scale bar
 * and everything inside stay true. Real mitochondria vary in size; that variation is not modelled.
 */
export const MITO_MODEL_SCALE = 0.05; // cell units (um) per model unit
export const MITO_CAPSULE = { radius: 0.2, length: 0.6 }; // the model's outline in cell units, long axis along Y
/** Mitochondrion units per angstrom: 1e-10 m / 5e-8 m. */
export const ATP_IN_MITO = 2e-3;

export interface Placed {
  p: THREE.Vector3;
  q: THREE.Quaternion;
  /** Diameter for granules (um); 1 for mitochondria. */
  s: number;
}

/**
 * Random placement without overlaps: every body is a set of spheres (a mitochondrion is five along its
 * axis), checked against everything placed before it through a coarse grid.
 */
const GRID = 0.6;
const grid = new Map<string, { c: THREE.Vector3; r: number }[]>();
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
function fits(spheres: { c: THREE.Vector3; r: number }[]): boolean {
  for (const s of spheres) {
    const gx = Math.floor(s.c.x / GRID), gy = Math.floor(s.c.y / GRID), gz = Math.floor(s.c.z / GRID);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const o of grid.get(key(gx + dx, gy + dy, gz + dz)) ?? []) if (o.c.distanceTo(s.c) < o.r + s.r) return false;
    }
  }
  return true;
}
function occupy(spheres: { c: THREE.Vector3; r: number }[]) {
  for (const s of spheres) {
    const k = key(Math.floor(s.c.x / GRID), Math.floor(s.c.y / GRID), Math.floor(s.c.z / GRID));
    const list = grid.get(k) ?? [];
    list.push(s);
    grid.set(k, list);
  }
}

/** Whether a body of the given reach centred at p is inside the cell and clear of the nucleus, ER, Golgi and cilium. */
export function freeSpace(p: THREE.Vector3, reach: number): boolean {
  return insideCell(p, reach) && clearOfNucleus(p, reach) && !EXCLUSIONS.some((e) => e.c.distanceTo(p) < e.r + reach);
}

const BOUND = Math.max(...PLANES.map((p) => p.d));

function scatter(
  seed: number,
  count: number,
  size: (r: () => number) => number,
  reachOf: (s: number) => number,
  body: (p: THREE.Vector3, q: THREE.Quaternion, s: number) => { c: THREE.Vector3; r: number }[],
): Placed[] {
  const r = rng(seed);
  const out: Placed[] = [];
  const p = new THREE.Vector3();
  for (let tries = 0; out.length < count && tries < count * 300; tries++) {
    p.set((r() * 2 - 1) * BOUND, (r() * 2 - 1) * BOUND, (r() * 2 - 1) * BOUND);
    const s = size(r);
    const reach = reachOf(s);
    if (!insideCell(p, reach) || !clearOfNucleus(p, reach)) continue;
    if (EXCLUSIONS.some((e) => e.c.distanceTo(p) < e.r + reach)) continue;
    const q = randomQuat(r);
    const spheres = body(p.clone(), q, s);
    if (!fits(spheres)) continue;
    occupy(spheres);
    out.push({ p: p.clone(), q, s });
  }
  if (out.length < count) console.warn(`placed ${out.length} of ${count}`);
  return out;
}

/** Normal deviate (Box-Muller). */
function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

// Rotation that maps the model's long axis (X) onto the capsule's long axis (Y).
export const MITO_TO_CAPSULE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
const Y = new THREE.Vector3(0, 1, 0);

export const CELL_LAYOUT = (() => {
  const half = MITO_CAPSULE.length / 2;
  const mitos = scatter(7, CELL_PARAMS.mitochondria, () => 1, () => half + MITO_CAPSULE.radius, (p, q) =>
    [-1, -0.5, 0, 0.5, 1].map((t) => ({ c: new THREE.Vector3(0, t * half, 0).applyQuaternion(q).add(p), r: MITO_CAPSULE.radius })),
  );
  const { mean, sd, min, max } = CELL_PARAMS.granuleDiameter;
  const granules = scatter(
    11,
    CELL_PARAMS.granules,
    (r) => THREE.MathUtils.clamp(mean + sd * gauss(r), min, max),
    (s) => s / 2,
    (p, _q, s) => [{ c: p, r: s / 2 }],
  );
  // Lysosomes: 0.25-0.5 um, count illustrative (no human beta-cell count found).
  const lysosomes = scatter(13, 40, (r) => 0.25 + 0.25 * r(), (s) => s / 2, (p, _q, s) => [{ c: p, r: s / 2 }]);
  return { mitos, granules, lysosomes };
})();

/** Free ribosomes (~25 nm). Only a sample is drawn: the real number is far larger. */
export const RIBOSOMES = (() => {
  const r = rng(17);
  const out: number[] = [];
  const p = new THREE.Vector3();
  while (out.length < 60000 * 3) {
    p.set((r() * 2 - 1) * BOUND, (r() * 2 - 1) * BOUND, (r() * 2 - 1) * BOUND);
    if (insideCell(p, 0.05) && clearOfNucleus(p, 0.02)) out.push(p.x, p.y, p.z);
  }
  return new Float32Array(out);
})();

/** Cortical actin: short filaments in a thin layer under the membrane. Illustrative. */
export const ACTIN = (() => {
  const r = rng(19);
  const out: number[] = [];
  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  while (out.length < 2500 * 6) {
    p.set((r() * 2 - 1) * BOUND, (r() * 2 - 1) * BOUND, (r() * 2 - 1) * BOUND);
    if (!insideCell(p, 0.0)) continue;
    const face = PLANES.find(({ n, d }) => n.dot(p) > d - MEMBRANE_MARGIN - 0.25);
    if (!face) continue;
    t.set(r() - 0.5, r() - 0.5, r() - 0.5).projectOnPlane(face.n).normalize().multiplyScalar(0.15 + 0.3 * r());
    out.push(p.x - t.x, p.y - t.y, p.z - t.z, p.x + t.x, p.y + t.y, p.z + t.z);
  }
  return new Float32Array(out);
})();

/**
 * The default cut: a plane facing the home view, a little in front of the nucleus centre, so the
 * nucleus is cut through. Points with dot(CUT.normal, p) > CUT.offset are removed.
 */
const CUT_NORMAL = new THREE.Vector3(0.25, 0.1, 1).normalize();
export const CUT = { normal: CUT_NORMAL, offset: CUT_NORMAL.dot(NUCLEUS) + 0.3 };

/** The cut face: where the cut plane meets the cell (a convex polygon), in cell coordinates. */
export const CUT_FACE: THREE.Vector3[] = (() => {
  const n = CUT.normal;
  const u = new THREE.Vector3(0, 1, 0).cross(n).normalize();
  const v = n.clone().cross(u);
  const o = n.clone().multiplyScalar(CUT.offset);
  let poly = [[-20, -20], [20, -20], [20, 20], [-20, 20]].map(([a, b]) => o.clone().addScaledVector(u, a).addScaledVector(v, b));
  for (const { n: pn, d } of PLANES) {
    const lim = d - 0.3; // inside the rounded edges
    const next: THREE.Vector3[] = [];
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const da = pn.dot(a) - lim, db = pn.dot(b) - lim;
      if (da <= 0) next.push(a);
      if (da * db < 0) next.push(a.clone().lerp(b, da / (da - db)));
    });
    poly = next;
  }
  return poly;
})();

/** Total granule volume as a share of the cell, for the panel text. */
export const GRANULE_VOLUME_SHARE =
  CELL_LAYOUT.granules.reduce((sum, g) => sum + (Math.PI / 6) * g.s ** 3, 0) / CELL_PARAMS.cellVolume;

/** Child view centres of a level's anchors, in that level's coordinates (for picking and focusing). */
const centerCache = new Map<LevelId, THREE.Vector3[]>();
export function anchorCenters(level: LevelId): THREE.Vector3[] {
  const hit = centerCache.get(level);
  if (hit) return hit;
  let out: THREE.Vector3[] = [];
  // Live references: the mitochondria move (CellScene), and picking follows them.
  if (level === 'cell') out = CELL_LAYOUT.mitos.map((m) => m.p);
  else if (level === 'mitochondrion' || level === 'atp-synthase') {
    out = Array.from({ length: anchorCount(level) }, (_, i) => makeAnchor(level, i, new THREE.Vector3(0, 0, 1)).center);
  }
  centerCache.set(level, out);
  return out;
}

export function anchorCount(level: LevelId): number {
  if (level === 'cell') return CELL_LAYOUT.mitos.length;
  if (level === 'mitochondrion') return getData().mitoSites.length;
  if (level === 'atp-synthase') return 1;
  return 0;
}

/**
 * Build the anchor for child `index` of `level`. `camera` (in the level's coordinates) is used only for
 * the mitochondrion: it is turned about its long axis so that its cut-open side faces the viewer.
 * That turn is invisible on the low-detail capsule, which is round about that axis.
 */
export function makeAnchor(level: LevelId, index: number, camera: THREE.Vector3): Anchor {
  const child = childOf(level);
  if (!child) throw new Error(`${level} has no child`);
  const matrix = new THREE.Matrix4();
  if (level === 'cell') {
    const m = CELL_LAYOUT.mitos[index];
    const local = camera.clone().sub(m.p).applyQuaternion(m.q.clone().invert());
    const spin = new THREE.Quaternion().setFromAxisAngle(Y, Math.atan2(local.x, local.z));
    const q = m.q.clone().multiply(spin).multiply(MITO_TO_CAPSULE);
    const s = MITO_MODEL_SCALE;
    matrix.compose(m.p, q, new THREE.Vector3(s, s, s));
  } else if (level === 'mitochondrion') {
    const site = getData().mitoSites[index];
    const n = new THREE.Vector3(...site.normal).normalize();
    // The site point sits just off the crista surface; the c-ring centre is in the membrane, about 2 nm in.
    const p = new THREE.Vector3(...site.position).addScaledVector(n, -20 * ATP_IN_MITO);
    matrix.compose(p, new THREE.Quaternion().setFromUnitVectors(Y, n), new THREE.Vector3(ATP_IN_MITO, ATP_IN_MITO, ATP_IN_MITO));
  } else if (level === 'atp-synthase') {
    const s = getData().atp;
    const site = new THREE.Vector3(...s.meta.site.position).sub(s.axisOrigin).applyQuaternion(s.align);
    matrix.makeTranslation(site.x, site.y, site.z);
  }
  const center = new THREE.Vector3(...LEVELS[child].viewCenter).applyMatrix4(matrix);
  const scale = new THREE.Vector3().setFromMatrixColumn(matrix, 0).length();
  return { child, index, matrix, center, scale };
}

export const HOME_DIR = new THREE.Vector3(0.35, 0.25, 1).normalize();

export function homeCamera(level: LevelId): THREE.Vector3 {
  const L = LEVELS[level];
  return new THREE.Vector3(...L.viewCenter).addScaledVector(HOME_DIR, L.homeDistance);
}

/** The child instance used when a level is opened directly from a link. */
export function defaultAnchor(level: LevelId): Anchor {
  const cam = homeCamera(level);
  const centers = anchorCenters(level);
  // The instance nearest to the spot the home view looks at, so the link opens somewhere sensible.
  const aim = new THREE.Vector3(...LEVELS[level].viewCenter);
  if (level === 'mitochondrion') aim.set(0, 0.5, -1); // a crista rim near the middle of the cut face
  let best = 0;
  centers.forEach((c, i) => {
    if (c.distanceTo(aim) < centers[best].distanceTo(aim)) best = i;
  });
  return makeAnchor(level, best, cam);
}
