import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CELL_PARAMS } from '../content/levels';
import { ACTIN, CELL_LAYOUT, CUT, CUT_FACE, MITO_MODEL_SCALE, MITO_TO_CAPSULE, RIBOSOMES, freeSpace, membraneDistance, type Placed } from '../engine/anchors';
import { MOTION, cageDiffusion, roughGauss, runStartRate, tickMotion, withJitter, withWobble } from '../engine/motion';
import { getWorld } from '../engine/world';
import { sim as physio } from '../sim/client';
import { getData } from '../engine/data';
import { cellCut, cutRemoves, nearClip, withCutaway, withPlaneCut, withPocket } from '../engine/pocket';
import { getSim, useSim } from '../engine/store';
import type { SceneProps } from './types';
import { fixTransparency } from './util';

const MITO_COLOR = new THREE.Color('#f08a4b');
const MITO_HOVER = new THREE.Color('#ffe08a');
const ZERO = new THREE.Vector3(0, 0, 0);

function visibleAt(p: THREE.Vector3): boolean {
  return p.distanceTo(nearClip.uClipCenter.value) >= nearClip.uClipRadius.value && !cutRemoves(p);
}

/** Ray casting that ignores instances hidden by the clip sphere around the camera or by the cut. */
function clippedRaycast(this: THREE.InstancedMesh, raycaster: THREE.Raycaster, hits: THREE.Intersection[]) {
  const mine: THREE.Intersection[] = [];
  THREE.InstancedMesh.prototype.raycast.call(this, raycaster, mine);
  const m = new THREE.Matrix4();
  const c = new THREE.Vector3();
  for (const h of mine) {
    this.getMatrixAt(h.instanceId!, m);
    c.setFromMatrixPosition(m).applyMatrix4(this.matrixWorld);
    if (visibleAt(c) && !cutRemoves(h.point)) hits.push(h);
  }
}

function noRaycast() {}

/** A small dot pattern for the ribosomes on the rough ER and the outer nuclear membrane. */
function ribosomeTexture(): THREE.Texture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#1d3f52';
  for (const [x, y] of [[16, 16], [48, 44]]) {
    g.beginPath();
    g.arc(x, y, 10, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const MEMBRANE_REST = new THREE.Color(0.62, 0.78, 0.86);
const MEMBRANE_FIRING = new THREE.Color(1.0, 0.5, 0.42);
const CYTO_REST = new THREE.Color('#f2e6b8');
const CYTO_CA = new THREE.Color('#ffb15e');
const FUSE_SECONDS = 0.8; // real time a fusing granule takes on screen
const MAX_FUSING = 60;

/** Membrane bending per material, in um (illustrative): ER and Golgi most, the nucleus least. */
const WOBBLE: Record<string, [number, number, number]> = {
  rough_er: [0.03, 1.5, 6],
  smooth_er: [0.04, 1.0, 4],
  golgi: [0.02, 1.2, 7],
  golgi_vesicle: [0.03, 0.6, 3],
  membrane: [0.02, 3, 9],
  nuclear_envelope: [0.008, 3, 12],
  pores: [0.008, 3, 12],
  heterochromatin: [0.012, 1.5, 10],
  nucleolus: [0.012, 2, 10],
  microtubule: [0.015, 2, 5],
  cilium: [0.06, 4, 8],
};

/**
 * Granules and lysosomes: each sits in a cage (actin mesh) and jitters around a home position; now and then
 * one is carried along a microtubule at ~1.2 um/s for a second or two (rates: engine/motion.ts), and its home moves with it.
 * Positions are written straight into the instance matrices' translation; rotation and size stay.
 */
class Movers {
  readonly n: number;
  readonly offset: Float32Array;
  readonly dir: Float32Array;
  readonly runLeft: Float32Array;
  readonly gone: Uint8Array;
  constructor(readonly bodies: Placed[]) {
    this.n = bodies.length;
    this.offset = new Float32Array(this.n * 3);
    this.dir = new Float32Array(this.n * 3);
    this.runLeft = new Float32Array(this.n);
    this.gone = new Uint8Array(this.n);
  }
  step(dt: number, count: number, glucose: number, meshes: THREE.InstancedMesh[]) {
    const { cageTau, runSpeed, runSeconds } = MOTION;
    // Ornstein-Uhlenbeck jitter: free diffusion with coefficient D over times shorter than cageTau.
    const cageSd = Math.sqrt(cageDiffusion(glucose) * cageTau);
    const decay = Math.exp(-dt / cageTau);
    const kick = cageSd * Math.sqrt(1 - decay * decay);
    const startP = runStartRate(glucose) * dt;
    const v = new THREE.Vector3();
    const o = this.offset;
    for (let i = 0; i < count; i++) {
      if (this.gone[i]) continue;
      const b = this.bodies[i];
      const j = i * 3;
      o[j] = o[j] * decay + kick * roughGauss();
      o[j + 1] = o[j + 1] * decay + kick * roughGauss();
      o[j + 2] = o[j + 2] * decay + kick * roughGauss();
      if (this.runLeft[i] > 0) {
        v.set(this.dir[j], this.dir[j + 1], this.dir[j + 2]).multiplyScalar(runSpeed * dt).add(b.p);
        this.runLeft[i] -= dt;
        if (freeSpace(v, b.s / 2)) b.p.copy(v);
        else this.runLeft[i] = 0; // reached the membrane or another organelle: the run ends
      } else if (Math.random() < startP) {
        v.set(roughGauss(), roughGauss(), roughGauss()).normalize();
        this.dir[j] = v.x;
        this.dir[j + 1] = v.y;
        this.dir[j + 2] = v.z;
        this.runLeft[i] = runSeconds * (0.5 + Math.random());
      }
      for (const mesh of meshes) {
        const a = mesh.instanceMatrix.array as Float32Array;
        a[i * 16 + 12] = b.p.x + o[j];
        a[i * 16 + 13] = b.p.y + o[j + 1];
        a[i * 16 + 14] = b.p.z + o[j + 2];
      }
    }
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  }
  /** Where body i is drawn now. */
  at(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.bodies[i].p).add(new THREE.Vector3(this.offset[i * 3], this.offset[i * 3 + 1], this.offset[i * 3 + 2]));
  }
}

/** Mitochondria: tethered, they wobble and turn a little in place (illustrative amplitudes). */
const MITO_HOME = CELL_LAYOUT.mitos.map((m) => ({
  p: m.p.clone(),
  q: m.q.clone(),
  clock: Math.random() * 100,
  phase: Array.from({ length: 6 }, () => Math.random() * Math.PI * 2),
  axis: new THREE.Vector3(roughGauss(), roughGauss(), roughGauss()).normalize(),
}));
const MITO_SHIFT = 0.05; // um
const MITO_TURN = THREE.MathUtils.degToRad(4);

/** Granules in order of release: nearest the membrane first. The first ones form the releasable pool. */
const RELEASE_ORDER = (() => {
  const idx = CELL_LAYOUT.granules.map((g, i) => ({ i, d: membraneDistance(g.p).d - g.s / 2 }));
  idx.sort((a, b) => a.d - b.d);
  return idx.map((x) => x.i);
})();

export function CellScene({ role, hidden, hover }: SceneProps) {
  const membraneMats = useMemo<THREE.MeshStandardMaterial[]>(() => [], []);
  const model = useMemo(() => {
    const s = getData().cell.clone(true);
    fixTransparency(s);
    const dots = ribosomeTexture();
    s.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      // UVs of the ER sheets are in micrometres; ribosomes sit about 70 nm apart.
      if (mat.name === 'rough_er') {
        mat.map = dots.clone();
        mat.map.repeat.set(1 / 0.07, 1 / 0.07);
        mat.map.needsUpdate = true;
      } else if (mat.name === 'nuclear_envelope') {
        mat.map = dots.clone();
        mat.map.repeat.set(250, 125); // the envelope's UVs run once around ~17 um and once pole to pole
        mat.map.needsUpdate = true;
      }
      if (mat.name === 'membrane') membraneMats.push(mat);
      // Organelles are cut away near the camera, like the granules, so a flight through them stays readable.
      const wob = WOBBLE[mat.name];
      mesh.material = withPlaneCut(wob ? withWobble(withCutaway(mat), ...wob) : withCutaway(mat));
      mesh.raycast = function (raycaster, hits) {
        const mine: THREE.Intersection[] = [];
        THREE.Mesh.prototype.raycast.call(this, raycaster, mine);
        for (const h of mine) if (visibleAt(h.point)) hits.push(h);
      };
    });
    return s;
  }, [membraneMats]);

  const sim = useSim();
  const granuleCount = sim.sparseGranules ? Math.floor(CELL_LAYOUT.granules.length / 10) : CELL_LAYOUT.granules.length;
  const lod = getData().mitoLod;
  const mats = useMemo(() => {
    const cut = <T extends THREE.Material>(m: T) => withPlaneCut(withPocket(m, nearClip) as T);
    return {
      mitoOuter: cut(new THREE.MeshStandardMaterial({ roughness: 0.5 })),
      mitoInner: cut(new THREE.MeshStandardMaterial({ color: '#c8503e', roughness: 0.55 })),
      // A granule is a crystalline insulin core inside its limiting membrane (translucent shell).
      core: cut(new THREE.MeshStandardMaterial({ color: '#e9cf92', roughness: 0.45 })),
      shell: cut(new THREE.MeshStandardMaterial({ color: '#f7f1e3', roughness: 0.3, transparent: true, opacity: 0.4, depthWrite: false })),
      lysosome: cut(new THREE.MeshStandardMaterial({ color: '#9b3b46', roughness: 0.6 })),
      // Free ribosomes jitter by ~20 nm; actin filaments flex (illustrative).
      ribosome: withPlaneCut(withJitter(new THREE.PointsMaterial({ color: '#2b4f66', size: 0.025, sizeAttenuation: true }), 0.02, 1.5)),
      actin: withPlaneCut(withWobble(new THREE.LineBasicMaterial({ color: '#d9874f', transparent: true, opacity: 0.35 }), 0.02, 0.8, 3)),
    };
  }, []);

  const groupRef = useRef<THREE.Group>(null);
  const mitoRef = useRef<THREE.InstancedMesh>(null);
  const mitoInnerRef = useRef<THREE.InstancedMesh>(null);
  const granuleRef = useRef<THREE.InstancedMesh>(null);
  const shellRef = useRef<THREE.InstancedMesh>(null);
  const lysoRef = useRef<THREE.InstancedMesh>(null);

  const ribosomeGeometry = useMemo(() => new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(RIBOSOMES, 3)), []);
  const actinGeometry = useMemo(() => new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(ACTIN, 3)), []);
  const cutFace = useMemo(() => {
    const centre = CUT_FACE.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(CUT_FACE.length);
    const pos: number[] = [];
    CUT_FACE.forEach((a, i) => {
      const b = CUT_FACE[(i + 1) % CUT_FACE.length];
      pos.push(centre.x, centre.y, centre.z, a.x, a.y, a.z, b.x, b.y, b.z);
    });
    const fill = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const rim = new THREE.BufferGeometry().setFromPoints(CUT_FACE);
    return { fill, rim };
  }, []);

  // The cut plane, carried into world coordinates (the cell may be drawn as context around a deeper level).
  const plane = useMemo(() => new THREE.Plane(), []);
  const cytoRef = useRef<THREE.MeshBasicMaterial>(null);
  // Granule release, driven by the model: each whole granule the model releases is taken from the
  // releasable pool (nearest the membrane), moved onto the membrane, and fades out as it fuses.
  const fusion = useMemo(() => ({ next: 0, releasedSeen: 0, lastT: -1, active: [] as { i: number; start: number; from: THREE.Vector3; to: THREE.Vector3 }[] }), []);
  const granuleMoves = useMemo(() => new Movers(CELL_LAYOUT.granules), []);
  const lysoMoves = useMemo(() => new Movers(CELL_LAYOUT.lysosomes), []);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  // Movement (real time). Runs before the release animation below, which then owns the fusing granules.
  useFrame((_, delta) => {
    if (!getSim().motion) return;
    const dt = Math.min(delta, 0.05);
    tickMotion(dt);
    const glucose = physio.latest?.glucose ?? 5;
    const count = getSim().sparseGranules ? Math.floor(CELL_LAYOUT.granules.length / 10) : CELL_LAYOUT.granules.length;
    granuleMoves.step(dt, count, glucose, [granuleRef.current!, shellRef.current!]);
    lysoMoves.step(dt, CELL_LAYOUT.lysosomes.length, glucose, [lysoRef.current!]);

    // Mitochondria. The one being zoomed into (or drawn in detail) holds still, so it stays where its
    // detailed model is placed; its own clock stops too, so it does not jump when released.
    const w = getWorld();
    const frozen = new Set<number>();
    if (hiddenRef.current != null) frozen.add(hiddenRef.current);
    if (w.level === 'cell' && w.focus) frozen.add(w.focus.index);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const turn = new THREE.Quaternion();
    CELL_LAYOUT.mitos.forEach((mito, i) => {
      const h = MITO_HOME[i];
      if (!frozen.has(i)) {
        h.clock += dt;
        const t = h.clock, f = h.phase;
        mito.p.set(
          h.p.x + MITO_SHIFT * Math.sin(0.9 * t + f[0]),
          h.p.y + MITO_SHIFT * Math.sin(0.7 * t + f[1]),
          h.p.z + MITO_SHIFT * Math.sin(1.1 * t + f[2]),
        );
        turn.setFromAxisAngle(h.axis, MITO_TURN * Math.sin(0.4 * t + f[3]));
        mito.q.copy(h.q).premultiply(turn);
      }
      s.setScalar(i === hiddenRef.current ? 0 : MITO_MODEL_SCALE);
      m.compose(mito.p, q.copy(mito.q).multiply(MITO_TO_CAPSULE), s);
      mitoRef.current!.setMatrixAt(i, m);
      mitoInnerRef.current!.setMatrixAt(i, m);
    });
    mitoRef.current!.instanceMatrix.needsUpdate = true;
    mitoInnerRef.current!.instanceMatrix.needsUpdate = true;
  });

  useFrame((state) => {
    const snap = physio.latest;
    if (!snap) return;
    const k = THREE.MathUtils.clamp((snap.vmaxTick + 65) / 65, 0, 1);
    for (const m of membraneMats) m.color.copy(MEMBRANE_REST).lerp(MEMBRANE_FIRING, k);
    if (cytoRef.current) {
      const c = THREE.MathUtils.clamp((snap.camMaxTick - 0.04) / 0.6, 0, 1);
      cytoRef.current.color.copy(CYTO_REST).lerp(CYTO_CA, c);
      cytoRef.current.opacity = 0.14 + 0.16 * c;
    }
    const now = state.clock.elapsedTime;
    const core = granuleRef.current!, shell = shellRef.current!;
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    if (snap.t < fusion.lastT) {
      // The model was reset: put every granule back.
      CELL_LAYOUT.granules.forEach(({ p, q, s }, i) => {
        m.compose(p, q, v.setScalar(s));
        core.setMatrixAt(i, m);
        shell.setMatrixAt(i, m);
      });
      granuleMoves.gone.fill(0);
      fusion.next = 0;
      fusion.releasedSeen = 0;
      fusion.active.length = 0;
    }
    fusion.lastT = snap.t;
    const whole = Math.floor(snap.released);
    let start = whole - fusion.releasedSeen;
    fusion.releasedSeen = whole;
    for (; start > 0 && fusion.next < RELEASE_ORDER.length; start--) {
      const i = RELEASE_ORDER[fusion.next++];
      const g = CELL_LAYOUT.granules[i];
      granuleMoves.gone[i] = 1; // the release animation owns it from here
      if (fusion.active.length >= MAX_FUSING) {
        core.setMatrixAt(i, m.makeScale(0, 0, 0));
        shell.setMatrixAt(i, m);
        continue;
      }
      const { d, n } = membraneDistance(g.p);
      const from = granuleMoves.at(i, new THREE.Vector3());
      fusion.active.push({ i, start: now, from, to: from.clone().addScaledVector(n, Math.max(0, d - g.s / 2 - 0.02)) });
    }
    fusion.active = fusion.active.filter((f) => {
      const g = CELL_LAYOUT.granules[f.i];
      const u = (now - f.start) / FUSE_SECONDS;
      if (u >= 1) {
        core.setMatrixAt(f.i, m.makeScale(0, 0, 0));
        shell.setMatrixAt(f.i, m);
        return false;
      }
      const move = THREE.MathUtils.smoothstep(u, 0, 0.6);
      const fade = 1 - THREE.MathUtils.smoothstep(u, 0.6, 1);
      v.copy(f.from).lerp(f.to, move);
      m.compose(v, g.q, new THREE.Vector3().setScalar(g.s * fade));
      core.setMatrixAt(f.i, m);
      m.compose(v, g.q, new THREE.Vector3().setScalar(g.s * (1 + 0.6 * (1 - fade))));
      shell.setMatrixAt(f.i, m);
      return true;
    });
    core.instanceMatrix.needsUpdate = true;
    shell.instanceMatrix.needsUpdate = true;
  });
  useFrame(() => {
    const g = groupRef.current;
    if (!g || !getSim().cutaway) {
      cellCut.uCutPlane.value.set(0, 0, 0, -1);
      return;
    }
    plane.set(CUT.normal, -CUT.offset).applyMatrix4(g.matrixWorld);
    cellCut.uCutPlane.value.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  });
  const cutOn = sim.cutaway;

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    CELL_LAYOUT.mitos.forEach(({ p, q: rot }, i) => {
      s.setScalar(i === hidden ? 0 : MITO_MODEL_SCALE);
      m.compose(p, q.copy(rot).multiply(MITO_TO_CAPSULE), s);
      mitoRef.current!.setMatrixAt(i, m);
      mitoInnerRef.current!.setMatrixAt(i, m);
    });
    for (const r of [mitoRef, mitoInnerRef]) {
      r.current!.instanceMatrix.needsUpdate = true;
      r.current!.computeBoundingSphere();
    }
  }, [hidden]);

  useLayoutEffect(() => {
    const mesh = mitoRef.current!;
    CELL_LAYOUT.mitos.forEach((_, i) => mesh.setColorAt(i, role === 'current' && i === hover ? MITO_HOVER : MITO_COLOR));
    mesh.instanceColor!.needsUpdate = true;
  }, [hover, role]);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    CELL_LAYOUT.granules.forEach(({ p, q, s }, i) => {
      m.compose(p, q, v.setScalar(s));
      granuleRef.current!.setMatrixAt(i, m);
      shellRef.current!.setMatrixAt(i, m);
    });
    CELL_LAYOUT.lysosomes.forEach(({ p, q, s }, i) => lysoRef.current!.setMatrixAt(i, m.compose(p, q, v.set(s, s * 0.85, s * 0.9))));
    for (const r of [granuleRef, shellRef, lysoRef]) {
      r.current!.instanceMatrix.needsUpdate = true;
      r.current!.computeBoundingSphere();
    }
  }, []);

  return (
    <group ref={groupRef}>
      <primitive object={model} />
      <instancedMesh ref={mitoRef} args={[lod.outer, mats.mitoOuter, CELL_LAYOUT.mitos.length]} userData={{ anchorLevel: 'cell' }} raycast={clippedRaycast} />
      <instancedMesh ref={mitoInnerRef} args={[lod.inner, mats.mitoInner, CELL_LAYOUT.mitos.length]} raycast={noRaycast} />
      <instancedMesh ref={granuleRef} args={[undefined, mats.core, CELL_LAYOUT.granules.length]} count={granuleCount} raycast={clippedRaycast}>
        <icosahedronGeometry args={[CELL_PARAMS.granuleCore / 2, 2]} />
      </instancedMesh>
      <instancedMesh ref={shellRef} args={[undefined, mats.shell, CELL_LAYOUT.granules.length]} count={granuleCount} raycast={noRaycast}>
        <icosahedronGeometry args={[0.5, 2]} />
      </instancedMesh>
      <instancedMesh ref={lysoRef} args={[undefined, mats.lysosome, CELL_LAYOUT.lysosomes.length]} raycast={clippedRaycast}>
        <icosahedronGeometry args={[0.5, 2]} />
      </instancedMesh>
      <points geometry={ribosomeGeometry} material={mats.ribosome} raycast={noRaycast} />
      <lineSegments geometry={actinGeometry} material={mats.actin} raycast={noRaycast} />
      {cutOn && (
        <group raycast={noRaycast}>
          <mesh geometry={cutFace.fill} raycast={noRaycast} renderOrder={2}>
            <meshBasicMaterial ref={cytoRef} color="#f2e6b8" transparent opacity={0.14} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
          <lineLoop geometry={cutFace.rim} raycast={noRaycast}>
            <lineBasicMaterial color="#9fd0e4" />
          </lineLoop>
        </group>
      )}
    </group>
  );
}
