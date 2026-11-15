// Where each child level sits inside its parent, at true scale.
// An anchor's matrix maps the child's own coordinates into the parent's coordinates, so
//   parent-frame point = anchor.matrix * child-frame point.
// The camera crosses from one level to the next by applying this matrix (or its inverse) to itself,
// which is why the zoom can be continuous: nothing on screen moves at the moment of the switch.
import * as THREE from 'three';
import { CELL_PARAMS, LEVELS, childOf, type LevelId } from '../content/levels';
import { randomInBall, randomQuat, rng } from '../scenes/util';
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

// ---- Cell layout (1 unit = 1 µm) ----
export const NUCLEUS = new THREE.Vector3(-1.3, 0.2, -0.4);
const NUCLEUS_CLEAR = 3.0;
const GOLGI = new THREE.Vector3(2.1, 0.9, -1.4);
const CYTOPLASM_RADIUS = 5.9; // inside the 6.5 um membrane

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
  s: number;
}

function scatter(seed: number, count: number, minGap: number, scale: (r: () => number) => number): Placed[] {
  const r = rng(seed);
  const out: Placed[] = [];
  while (out.length < count) {
    const p = randomInBall(r, CYTOPLASM_RADIUS);
    if (p.distanceTo(NUCLEUS) < NUCLEUS_CLEAR + minGap) continue;
    if (p.distanceTo(GOLGI) < 1.2 + minGap) continue;
    out.push({ p, q: randomQuat(r), s: scale(r) });
  }
  return out;
}

export const CELL_LAYOUT = {
  mitos: scatter(7, CELL_PARAMS.mitochondria, 0.1, () => 1),
  granules: scatter(11, CELL_PARAMS.granules, 0.1, () => 1),
};

// Rotation that maps the model's long axis (X) onto the capsule's long axis (Y).
const MITO_TO_CAPSULE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
const Y = new THREE.Vector3(0, 1, 0);

/** Child view centres of a level's anchors, in that level's coordinates (for picking and focusing). */
const centerCache = new Map<LevelId, THREE.Vector3[]>();
export function anchorCenters(level: LevelId): THREE.Vector3[] {
  const hit = centerCache.get(level);
  if (hit) return hit;
  let out: THREE.Vector3[] = [];
  if (level === 'cell') out = CELL_LAYOUT.mitos.map((m) => m.p.clone());
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
