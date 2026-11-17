import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CELL_PARAMS } from '../content/levels';
import { ACTIN, CELL_LAYOUT, CUT, CUT_FACE, MITO_MODEL_SCALE, MITO_TO_CAPSULE, RIBOSOMES, membraneDistance } from '../engine/anchors';
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
      mesh.material = withPlaneCut(withCutaway(mat));
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
      ribosome: withPlaneCut(new THREE.PointsMaterial({ color: '#2b4f66', size: 0.025, sizeAttenuation: true })),
      actin: withPlaneCut(new THREE.LineBasicMaterial({ color: '#d9874f', transparent: true, opacity: 0.35 })),
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
      if (fusion.active.length >= MAX_FUSING) {
        core.setMatrixAt(i, m.makeScale(0, 0, 0));
        shell.setMatrixAt(i, m);
        continue;
      }
      const { d, n } = membraneDistance(g.p);
      fusion.active.push({ i, start: now, from: g.p.clone(), to: g.p.clone().addScaledVector(n, Math.max(0, d - g.s / 2 - 0.02)) });
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
