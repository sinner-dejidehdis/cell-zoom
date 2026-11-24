// The molecular and atomic levels of the muscle page. When the camera gets close to the active myofibril,
// the filaments around the point being looked at are rebuilt from molecules: actin subunits on the real
// helix, the two tropomyosin strands, troponin every seven actins, and the thick filament with its myosin
// heads. Closer still, one actin-myosin contact is drawn atom by atom.
//
// Shapes and positions come from cryo-EM structures (see tools/pdb/build_actomyosin.py):
//   8EFI  human beta myosin (MYH7) bound to actin with tropomyosin, rigor: atoms, actin and myosin shapes,
//         and how an attached head sits on actin;
//   6KN7 / 6KN8  thin filament without / with calcium: where tropomyosin lies, and troponin.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { asset } from '../scenes/util';
import { ALL_FIBRILS, FIBER, anchorX, fiberU, inWedge } from './fiber';
import { activeFibril } from './MuscleScene';
import { getMuscleView, setMuscleView, type MuscleLevel } from './store';

const A = 1e-4; // one angstrom in micrometres

interface Meta {
  rise: number; twist: number; atomCount: number; elements: string[]; roles: string[];
  actinDomains: number[][][]; myosinDomains: number[][][]; troponinChains: number[][][];
  tropomyosin: Record<'blocked' | 'closed' | 'open', { offset: number; radius: number }>;
}
interface Acto { meta: Meta; pos: Float32Array; el: Uint8Array; role: Uint8Array; sub: Int8Array }

let loading: Promise<Acto> | null = null;
function load(): Promise<Acto> {
  loading ??= Promise.all([
    fetch(asset('data/actomyosin.json')).then((r) => r.json() as Promise<Meta>),
    fetch(asset('data/actomyosin.bin')).then((r) => r.arrayBuffer()),
  ]).then(([meta, buf]) => {
    const n = meta.atomCount;
    return {
      meta,
      pos: new Float32Array(buf, 0, n * 3),
      el: new Uint8Array(buf, n * 12, n),
      role: new Uint8Array(buf, n * 13, n),
      sub: new Int8Array(buf, n * 14, n),
    };
  });
  return loading;
}

function hull(domains: number[][][]): THREE.BufferGeometry {
  const parts = domains.filter((d) => d.length >= 4).map((d) => new ConvexGeometry(d.map((p) => new THREE.Vector3(p[0] * A, p[1] * A, p[2] * A))));
  const g = mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); return p; }))!;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ---- layout of the patch ----

/** Half-length (um) of the stretch of myofibril rebuilt from molecules, and its half-width. */
const W = 0.3, RL = 0.075;
const RISE = 27.9 * A;
const TWIST = (-166.4 * Math.PI) / 180;
const CROWN = 0.0143;
const BACKBONE_R = 0.0075;

const Y_FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

interface Filament { key: string; y: number; z: number; side: 1 | -1; phase: number; n0: number; n1: number }
interface ZGroup { k: number; group: THREE.Group; fils: Filament[] }
interface Head { thick: number; x: number; theta: number; base: THREE.Vector3; detached: THREE.Matrix4; hash: number }
interface MGroup { k: number; group: THREE.Group; thick: { y: number; z: number }[]; heads: Head[] }

function hash(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Lattice points of one myofibril, relative to its axis (same as the filament level). */
const LATTICE = (() => {
  const a = FIBER.lattice, r = FIBER.myofibrilRadius;
  const thick: [number, number][] = [], thin: [number, number][] = [];
  const n = Math.ceil(r / a) + 1;
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    const y = (i + j / 2) * a, z = (j * Math.sqrt(3) * a) / 2;
    if (Math.hypot(y, z) < r - 0.01) thick.push([y, z]);
    for (const [ty, tz] of [[a / 2, (a * Math.sqrt(3)) / 6], [0, (a * Math.sqrt(3)) / 3]]) {
      if (Math.hypot(y + ty, z + tz) < r - 0.005) thin.push([y + ty, z + tz]);
    }
  }
  return { thick, thin };
})();

/** Matrix of actin subunit n of a filament, in its Z-disc group's coordinates (um). */
function actinMatrix(f: Filament, n: number, out = new THREE.Matrix4()): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), f.phase + n * TWIST);
  if (f.side < 0) q.premultiply(Y_FLIP);
  return out.compose(new THREE.Vector3(f.side * n * RISE, f.y, f.z), q, new THREE.Vector3(1, 1, 1));
}

function sphereRaycast(radius: number) {
  const m = new THREE.Matrix4(), c = new THREE.Vector3(), s = new THREE.Sphere(), hit = new THREE.Vector3();
  return function (this: THREE.InstancedMesh, raycaster: THREE.Raycaster, hits: THREE.Intersection[]) {
    const center = this.geometry.boundingSphere?.center ?? new THREE.Vector3();
    let best: THREE.Intersection | null = null;
    for (let i = 0; i < this.count; i++) {
      this.getMatrixAt(i, m);
      if (m.getMaxScaleOnAxis() < 1e-9) continue;
      c.copy(center).applyMatrix4(m).applyMatrix4(this.matrixWorld);
      s.set(c, radius * m.getMaxScaleOnAxis());
      if (!raycaster.ray.intersectSphere(s, hit)) continue;
      const d = hit.distanceTo(raycaster.ray.origin);
      if (!best || d < best.distance) best = { distance: d, point: hit.clone(), object: this, instanceId: i } as THREE.Intersection;
    }
    if (best) hits.push(best);
  };
}

// ---- the component ----

interface Patch {
  fibril: number; y0: number; z0: number; yt: number; zt: number; xc: number; sl: number;
  root: THREE.Group; zs: ZGroup[]; ms: MGroup[];
  actin: { mesh: THREE.InstancedMesh; z: ZGroup; list: { f: Filament; n: number }[] }[];
  tm: { mesh: THREE.InstancedMesh; z: ZGroup; list: { f: Filament; n: number }[] }[];
  heads: { mesh: THREE.InstancedMesh; m: MGroup; lines: THREE.LineSegments }[];
}

const VDW: Record<string, number> = { C: 1.7, N: 1.55, O: 1.52, S: 1.8, P: 1.8, MG: 1.73, OTHER: 1.7 };
const ROLE_COLOR = ['#7fc8a9', '#c8553d', '#e7c35a', '#ff5fd2'];
const ELEMENT_SHADE: Record<string, number> = { C: 1.0, N: 0.8, O: 0.88, S: 1.2, P: 1.1, MG: 1.0, OTHER: 1 };

export function MolecularLevel() {
  const [acto, setActo] = useState<Acto | null>(null);
  useEffect(() => { load().then(setActo).catch((e) => console.error('actomyosin', e)); }, []);
  const { scene, camera, controls } = useThree() as unknown as { scene: THREE.Scene; camera: THREE.Camera; controls: { target: THREE.Vector3 } | null };

  const shapes = useMemo(() => {
    if (!acto) return null;
    const m = acto.meta;
    const actin = hull(m.actinDomains);
    const head = hull(m.myosinDomains);
    const tn = hull(m.troponinChains);
    const lever = m.myosinDomains[3];
    const L = new THREE.Vector3(...lever[lever.length - 1]).multiplyScalar(A);
    const all = m.myosinDomains.flat();
    const C = all.reduce((acc, p) => acc.add(new THREE.Vector3(...p)), new THREE.Vector3()).multiplyScalar(A / all.length);
    // Head axes for the detached pose: a from the lever end to the motor, b roughly along the actin axis.
    const a = C.clone().sub(L).normalize();
    const b = new THREE.Vector3(1, 0, 0).addScaledVector(a, -a.x).normalize();
    const headBasis = new THREE.Matrix4().makeBasis(a, b, a.clone().cross(b));
    const mats = {
      actin: new THREE.MeshStandardMaterial({ color: '#7fc8a9', roughness: 0.55 }),
      tm: new THREE.MeshStandardMaterial({ color: '#e7c35a', roughness: 0.4 }),
      tn: new THREE.MeshStandardMaterial({ color: '#9b7fe0', roughness: 0.5 }),
      head: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 }),
      backbone: new THREE.MeshStandardMaterial({ color: '#b5463a', roughness: 0.5 }),
      s2: new THREE.LineBasicMaterial({ color: '#d9826f' }),
      atom: new THREE.MeshStandardMaterial({ roughness: 0.5 }),
    };
    return { actin, head, tn, L, headBasis, mats, tmGeo: new THREE.CylinderGeometry(0.001, 0.001, 1, 6, 1).rotateZ(-Math.PI / 2).translate(0.5, 0, 0) };
  }, [acto]);

  const root = useMemo(() => new THREE.Group(), []);
  const patch = useRef<Patch | null>(null);
  const atoms = useRef<{ mesh: THREE.InstancedMesh | null; at: string } | null>(null);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), m2: new THREE.Matrix4(), v: new THREE.Vector3(), v2: new THREE.Vector3(), q: new THREE.Quaternion(), c: new THREE.Color() }), []);

  useEffect(() => {
    scene.add(root);
    return () => { scene.remove(root); };
  }, [scene, root]);

  function build(fibril: number, xc: number, yt: number, zt: number, sl: number): Patch {
    const S = shapes!;
    root.clear();
    const { y: y0, z: z0 } = ALL_FIBRILS[fibril];
    const cut = getMuscleView().cut;
    const inBox = (y: number, z: number) => Math.abs(y0 + y - yt) < RL && Math.abs(z0 + z - zt) < RL && !(cut && inWedge(y0 + y, z0 + z));
    const NS = FIBER.sarcomeres, nMax = Math.floor(FIBER.thin / RISE);
    const zs: ZGroup[] = [], ms: MGroup[] = [];
    const p: Patch = { fibril, y0, z0, yt, zt, xc, sl, root, zs, ms, actin: [], tm: [], heads: [] };

    // Thin filaments, grouped by the Z-disc they grow from.
    for (let k = 0; k <= NS; k++) {
      const zx = anchorX(k, 0, sl);
      if (Math.abs(zx - xc) > W + FIBER.thin + 0.05) continue;
      const zg: ZGroup = { k, group: new THREE.Group(), fils: [] };
      for (const side of [-1, 1] as const) {
        if ((k === 0 && side < 0) || (k === NS && side > 0)) continue;
        LATTICE.thin.forEach(([y, z], i) => {
          if (!inBox(y, z)) return;
          // Subunits inside the window (with a margin for sliding).
          const e0 = (side * (xc - W - 0.1 - zx)) / RISE, e1 = (side * (xc + W + 0.1 - zx)) / RISE;
          const n0 = Math.max(0, Math.ceil(Math.min(e0, e1))), n1 = Math.min(nMax, Math.floor(Math.max(e0, e1)));
          if (n1 < n0) return;
          zg.fils.push({ key: `${k}:${side}:${i}`, y, z, side, phase: hash(i * 7 + k) * Math.PI * 2, n0, n1 });
        });
      }
      if (!zg.fils.length) continue;
      const list: { f: Filament; n: number }[] = [];
      const tmList: { f: Filament; n: number }[] = [];
      const tnList: { f: Filament; n: number }[] = [];
      for (const f of zg.fils) for (let n = f.n0; n <= f.n1; n++) {
        list.push({ f, n });
        if (n + 2 <= f.n1) tmList.push({ f, n });
        if (n % 14 === 0 || n % 14 === 7) tnList.push({ f, n });
      }
      const act = new THREE.InstancedMesh(S.actin, S.mats.actin, list.length);
      list.forEach(({ f, n }, i) => act.setMatrixAt(i, actinMatrix(f, n, tmp.m)));
      act.raycast = sphereRaycast(0.003);
      act.computeBoundingSphere();
      const tm = new THREE.InstancedMesh(S.tmGeo, S.mats.tm, tmList.length);
      tm.raycast = () => {};
      const tn = new THREE.InstancedMesh(S.tn, S.mats.tn, tnList.length);
      tnList.forEach(({ f, n }, i) => tn.setMatrixAt(i, actinMatrix(f, n, tmp.m)));
      tn.raycast = sphereRaycast(0.004);
      zg.group.add(act, tm, tn);
      for (const o of [act, tm, tn]) o.frustumCulled = false;
      p.actin.push({ mesh: act, z: zg, list });
      p.tm.push({ mesh: tm, z: zg, list: tmList });
      zs.push(zg);
      root.add(zg.group);
    }

    // Thick filaments, grouped by M-line.
    for (let k = 0; k < NS; k++) {
      const mx = anchorX(k, 1, sl);
      if (Math.abs(mx - xc) > W + FIBER.thick / 2 + 0.05) continue;
      const mg: MGroup = { k, group: new THREE.Group(), thick: [], heads: [] };
      const lo = Math.max(-FIBER.thick / 2, xc - W - mx), hi = Math.min(FIBER.thick / 2, xc + W - mx);
      if (hi <= lo) continue;
      LATTICE.thick.forEach(([y, z], ti) => {
        if (!inBox(y, z)) return;
        mg.thick.push({ y, z });
        const phase = hash(ti * 3 + k) * 360;
        for (const sgn of [-1, 1]) {
          for (let j = 0; ; j++) {
            const x = sgn * (FIBER.bare / 2 + j * CROWN);
            if (Math.abs(x) > FIBER.thick / 2 - 0.01) break;
            if (x < lo || x > hi) continue;
            for (let c = 0; c < 3; c++) for (const pair of [-1, 1]) {
              const theta = ((phase + j * 40 + c * 120 + pair * 9) * Math.PI) / 180;
              const radial = new THREE.Vector3(0, Math.cos(theta), Math.sin(theta));
              const base = new THREE.Vector3(x, y, z).addScaledVector(radial, BACKBONE_R);
              // Detached: lying back along the backbone towards the M-line, tilted out by 30 degrees.
              const dir = new THREE.Vector3(-sgn * Math.cos(Math.PI / 6), 0, 0).addScaledVector(radial, Math.sin(Math.PI / 6)).normalize();
              const target = new THREE.Matrix4().makeBasis(dir, radial.clone().addScaledVector(dir, -radial.dot(dir)).normalize(), dir.clone().cross(radial.clone().addScaledVector(dir, -radial.dot(dir)).normalize()));
              const rot = target.multiply(S.headBasis.clone().invert());
              const det = new THREE.Matrix4().makeTranslation(base.x, base.y, base.z).multiply(rot).multiply(new THREE.Matrix4().makeTranslation(-S.L.x, -S.L.y, -S.L.z));
              mg.heads.push({ thick: mg.thick.length - 1, x, theta, base, detached: det, hash: hash(mg.heads.length * 13 + k * 101 + ti) });
            }
          }
        }
      });
      if (!mg.thick.length) continue;
      const bb = new THREE.InstancedMesh(new THREE.CylinderGeometry(BACKBONE_R * 0.9, BACKBONE_R * 0.9, hi - lo, 10, 1).rotateZ(-Math.PI / 2), S.mats.backbone, mg.thick.length);
      mg.thick.forEach((t, i) => bb.setMatrixAt(i, tmp.m.makeTranslation((lo + hi) / 2, t.y, t.z)));
      bb.raycast = () => {};
      const heads = new THREE.InstancedMesh(S.head, S.mats.head, mg.heads.length);
      heads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mg.heads.length * 3), 3);
      heads.raycast = sphereRaycast(0.006);
      const lines = new THREE.LineSegments(new THREE.BufferGeometry(), S.mats.s2);
      lines.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mg.heads.length * 6), 3));
      lines.raycast = () => {};
      for (const o of [bb, heads, lines]) o.frustumCulled = false;
      mg.group.add(bb, heads, lines);
      p.heads.push({ mesh: heads, m: mg, lines });
      ms.push(mg);
      root.add(mg.group);
    }
    return p;
  }

  useFrame(() => {
    const fiberG = scene.getObjectByName('fiber');
    if (!shapes || !controls || !fiberG) return;
    const sl = fiberU.uSL.value;
    const dist = camera.position.distanceTo(controls.target);
    fiberG.updateMatrixWorld();
    const tl = fiberG.worldToLocal(tmp.v.copy(controls.target));
    const fibril = activeFibril.index;
    const F = ALL_FIBRILS[fibril];
    const onFibril = Math.hypot(tl.y - F.y, tl.z - F.z) < FIBER.myofibrilRadius + 0.1;
    const level: MuscleLevel = dist > 15 ? 'fiber' : dist > 0.6 || !onFibril ? 'myofibril' : dist > 0.045 ? 'molecule' : 'atom';
    if (getMuscleView().level !== level) setMuscleView({ level });
    const want = level === 'molecule' || level === 'atom';
    const xr = (tl.x * sl) / FIBER.slRest;
    let p = patch.current;
    if (!want) {
      if (p) { root.clear(); patch.current = p = null; atoms.current = null; fiberU.uHoleMin.value.set(1e9, 1e9, 1e9); fiberU.uHoleMax.value.set(-1e9, -1e9, -1e9); }
      return;
    }
    if (!p || p.fibril !== fibril || Math.abs(p.xc - xr) > 0.12 || Math.hypot(p.yt - tl.y, p.zt - tl.z) > 0.03 || Math.abs(p.sl - sl) > 0.03) {
      patch.current = p = build(fibril, xr, tl.y, tl.z, sl);
      atoms.current = null;
    }
    // Hide the plain filaments where the molecules are.
    const k = FIBER.slRest / sl;
    fiberU.uHoleMin.value.set((p.xc - W) * k, p.yt - RL, p.zt - RL);
    fiberU.uHoleMax.value.set((p.xc + W) * k, p.yt + RL, p.zt + RL);
    // Place the patch where the fibre group puts this myofibril, unscaled so the molecules keep their shape.
    root.position.copy(fiberG.localToWorld(tmp.v2.set(0, p.y0, p.z0)));
    root.position.x = fiberG.position.x;
    for (const z of p.zs) z.group.position.x = anchorX(z.k, 0, sl);
    for (const m of p.ms) m.group.position.x = anchorX(m.k, 1, sl);

    // Tropomyosin: between its blocked (no Ca2+), closed (Ca2+) and open (myosin bound) positions.
    const tmMeta = acto!.meta.tropomyosin;
    const caF = fiberU.uCa.value, att = fiberU.uAttached.value;
    const offset = tmMeta.blocked.offset + (tmMeta.closed.offset - tmMeta.blocked.offset) * Math.min(1, caF * 2) + (tmMeta.open.offset - tmMeta.closed.offset) * Math.min(1, att / 0.35);
    const rTm = tmMeta.closed.radius * A;

    // Atom level: the actin subunit nearest to the point being looked at.
    let site: { f: Filament; n: number; z: ZGroup } | null = null;
    if (level === 'atom') {
      let best = Infinity;
      const ly = tl.y - p.y0, lz = tl.z - p.z0;
      for (const z of p.zs) {
        const zx = anchorX(z.k, 0, sl);
        for (const f of z.fils) {
          const dl = Math.hypot(f.y - ly, f.z - lz);
          if (dl > 0.03) continue;
          const n = Math.round((f.side * (xr - zx)) / RISE);
          if (n < f.n0 + 2 || n > f.n1 - 2) continue;
          if (dl < best) { best = dl; site = { f, n, z }; }
        }
      }
    }
    const hidden = (f: Filament, n: number, span = 2) => !!site && site.f === f && Math.abs(n - site.n) <= span;

    tmp.c.set('#000');
    for (const t of p.tm) {
      t.list.forEach(({ f, n }, i) => {
        if (hidden(f, n, 3)) { t.mesh.setMatrixAt(i, tmp.m.makeScale(0, 0, 0)); return; }
        const a0 = actinMatrix(f, n, tmp.m), a1 = actinMatrix(f, n + 2, tmp.m2);
        const off = (offset * Math.PI) / 180;
        const p0 = new THREE.Vector3(0, Math.cos(off), Math.sin(off)).multiplyScalar(rTm).applyMatrix4(a0);
        const p1 = new THREE.Vector3(0, Math.cos(off), Math.sin(off)).multiplyScalar(rTm).applyMatrix4(a1);
        const d = p1.clone().sub(p0);
        tmp.q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.clone().normalize());
        t.mesh.setMatrixAt(i, tmp.m.compose(p0, tmp.q, new THREE.Vector3(d.length(), 1, 1)));
      });
      t.mesh.instanceMatrix.needsUpdate = true;
    }

    // Myosin heads: a share `att` of them is bound to the nearest actin facing their thick filament.
    const thinByKey = new Map<string, { f: Filament; z: ZGroup }>();
    for (const z of p.zs) for (const f of z.fils) thinByKey.set(`${z.k}:${f.side}:${f.y.toFixed(3)}:${f.z.toFixed(3)}`, { f, z });
    const nb = FIBER.lattice / Math.sqrt(3);
    for (const h of p.heads) {
      const mx = anchorX(h.m.k, 1, sl);
      const siteM = site ? new THREE.Vector3().setFromMatrixPosition(actinMatrix(site.f, site.n, tmp.m)).add(new THREE.Vector3(anchorX(site.z.k, 0, sl) - mx, 0, 0)) : null;
      const pos = h.lines.geometry.attributes.position as THREE.BufferAttribute;
      h.m.heads.forEach((hd, i) => {
        let mat: THREE.Matrix4 | null = null;
        if (hd.hash < att) {
          const t = h.m.thick[hd.thick];
          // Neighbouring thin filament in the head's direction (six at 60 degree steps, from 30 degrees).
          const ang = Math.round(((hd.theta * 180) / Math.PI - 30) / 60) * 60 + 30;
          const ty = t.y + nb * Math.cos((ang * Math.PI) / 180), tz = t.z + nb * Math.sin((ang * Math.PI) / 180);
          const zk = hd.x < 0 ? h.m.k : h.m.k + 1, side = hd.x < 0 ? 1 : -1;
          const fz = thinByKey.get(`${zk}:${side}:${ty.toFixed(3)}:${tz.toFixed(3)}`);
          if (fz) {
            const zx = anchorX(zk, 0, sl);
            const n0 = Math.round((side * (mx + hd.x - zx)) / RISE);
            const want = new THREE.Vector3(0, t.y - ty, t.z - tz).normalize();
            let bestN = -1, bestS = -Infinity;
            for (let n = n0 - 7; n <= n0 + 7; n++) {
              if (n < fz.f.n0 || n > fz.f.n1 || hidden(fz.f, n, 3)) continue;
              const up = new THREE.Vector3(0, 1, 0).applyMatrix4(tmp.m2.extractRotation(actinMatrix(fz.f, n, tmp.m)));
              const s = up.dot(want) - Math.abs(n - n0) * 0.05;
              if (s > bestS) { bestS = s; bestN = n; }
            }
            if (bestN >= 0 && bestS > 0.6) {
              mat = new THREE.Matrix4().makeTranslation(zx - mx, 0, 0).multiply(actinMatrix(fz.f, bestN, tmp.m));
            }
          }
        }
        // Keep heads out of the way of the atomic model.
        if (!mat && siteM && hd.base.distanceTo(siteM) < 0.022) mat = ZERO;
        const attached = !!mat && mat !== ZERO;
        if (!mat) mat = hd.detached;
        h.mesh.setMatrixAt(i, mat);
        h.mesh.setColorAt(i, tmp.c.set(attached ? '#ffd24a' : '#c8553d'));
        const lever = mat === ZERO ? S_LEVER.copy(hd.base) : S_LEVER.copy(shapes.L).applyMatrix4(mat);
        pos.setXYZ(i * 2, hd.base.x, hd.base.y, hd.base.z);
        pos.setXYZ(i * 2 + 1, lever.x, lever.y, lever.z);
      });
      h.mesh.instanceMatrix.needsUpdate = true;
      if (h.mesh.instanceColor) h.mesh.instanceColor.needsUpdate = true;
      pos.needsUpdate = true;
    }

    // Actin: hide the subunits replaced by atoms.
    const at = site ? `${site.f.key}:${site.n}` : '';
    if (!atoms.current || atoms.current.at !== at) {
      for (const a of p.actin) {
        a.list.forEach(({ f, n }, i) => a.mesh.setMatrixAt(i, hidden(f, n) ? tmp.m.makeScale(0, 0, 0) : actinMatrix(f, n, tmp.m)));
        a.mesh.instanceMatrix.needsUpdate = true;
      }
      atoms.current?.mesh?.removeFromParent();
      atoms.current = null;
      if (site && acto) {
        const mesh = buildAtoms(acto, shapes.mats.atom);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(actinMatrix(site.f, site.n, tmp.m)).multiply(tmp.m2.makeScale(A, A, A));
        site.z.group.add(mesh);
        atoms.current = { mesh, at };
      } else atoms.current = { mesh: null, at };
    }
  });
  return null;
}

const S_LEVER = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function buildAtoms(acto: Acto, material: THREE.Material): THREE.InstancedMesh {
  const n = acto.meta.atomCount;
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), material, n);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const centres = new Float32Array(n * 3), radii = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const el = acto.meta.elements[acto.el[i]];
    const r = VDW[el] ?? 1.7;
    const x = acto.pos[i * 3], y = acto.pos[i * 3 + 1], z = acto.pos[i * 3 + 2];
    m.makeScale(r, r, r).setPosition(x, y, z);
    mesh.setMatrixAt(i, m);
    centres.set([x, y, z], i * 3);
    radii[i] = r;
    const role = acto.role[i];
    c.set(ROLE_COLOR[role] ?? '#bbbbbb');
    if (role === 0 && acto.sub[i] % 2 !== 0) c.multiplyScalar(0.78); // alternate subunits
    c.multiplyScalar(ELEMENT_SHADE[el] ?? 1);
    mesh.setColorAt(i, c);
  }
  mesh.frustumCulled = false;
  // Ray test against the atom spheres (the triangle test would be far too slow).
  const inv = new THREE.Matrix4(), ray = new THREE.Ray(), toC = new THREE.Vector3();
  mesh.raycast = function (raycaster, hits) {
    inv.copy(this.matrixWorld).invert();
    ray.copy(raycaster.ray).applyMatrix4(inv);
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      toC.set(centres[i * 3] - ray.origin.x, centres[i * 3 + 1] - ray.origin.y, centres[i * 3 + 2] - ray.origin.z);
      const tc = toC.dot(ray.direction);
      if (tc < 0) continue;
      const d2 = toC.lengthSq() - tc * tc, r = radii[i];
      if (d2 > r * r) continue;
      const t = tc - Math.sqrt(r * r - d2);
      if (t > 0 && t < best) best = t;
    }
    if (best === Infinity) return;
    const point = ray.at(best, new THREE.Vector3()).applyMatrix4(this.matrixWorld);
    hits.push({ distance: point.distanceTo(raycaster.ray.origin), point, object: this } as THREE.Intersection);
  };
  return mesh;
}
