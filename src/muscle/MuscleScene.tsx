import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { muscle } from '../sim/muscle/client';
import { FIBER, L0, LAYOUT, fiberMaterial, fiberU } from './fiber';
import { getMuscleView } from './store';

const X_AXIS = new THREE.Matrix4().makeRotationZ(-Math.PI / 2); // cylinder (Y) -> fibre axis (X)
const RING_AXIS = new THREE.Matrix4().makeRotationY(Math.PI / 2); // torus (axis Z) -> axis X

function along(geo: THREE.BufferGeometry, m = X_AXIS) {
  return geo.applyMatrix4(m);
}

/** Instanced geometry with a per-instance aSarc attribute (sarcomere index, anchor, offset). */
function sarcInstances(base: THREE.BufferGeometry, items: { y: number; z: number; k: number; anchor: number; dx: number; s?: [number, number, number] }[]) {
  const mesh = new THREE.InstancedMesh(base, undefined, items.length);
  const sarc = new Float32Array(items.length * 3);
  const m = new THREE.Matrix4();
  items.forEach((it, i) => {
    m.makeScale(...(it.s ?? [1, 1, 1])).setPosition(0, it.y, it.z);
    mesh.setMatrixAt(i, m);
    sarc.set([it.k, it.anchor, it.dx], i * 3);
  });
  base.setAttribute('aSarc', new THREE.InstancedBufferAttribute(sarc, 3));
  mesh.frustumCulled = false; // instances move every frame
  mesh.raycast = () => {};
  return mesh;
}

function buildFiber() {
  const group = new THREE.Group();
  const { sarcomeres: NS, myofibrilRadius: r, thick, thin, bare, lattice, radius: R } = FIBER;

  // Myofibrils: solid rods with the striation pattern computed from the current sarcomere length.
  const rodGeo = along(new THREE.CylinderGeometry(r, r, L0, 16, 1, false));
  const rods = new THREE.InstancedMesh(rodGeo, fiberMaterial(new THREE.MeshStandardMaterial({ color: '#d0675a', roughness: 0.6, side: THREE.DoubleSide }), { banded: true, key: 'rod' }), LAYOUT.myofibrils.length);
  const m = new THREE.Matrix4();
  LAYOUT.myofibrils.forEach((p, i) => rods.setMatrixAt(i, m.makeTranslation(0, p.y, p.z)));
  rods.raycast = () => {};
  group.add(rods);

  // The detailed myofibril: thick filaments on a hexagonal lattice, thin filaments at the trigonal points.
  const D = LAYOUT.detailed;
  const thickPts: [number, number][] = [];
  const thinPts: [number, number][] = [];
  const a = lattice;
  const n = Math.ceil(r / a) + 1;
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    const y = (i + j / 2) * a, z = (j * Math.sqrt(3) * a) / 2;
    if (Math.hypot(y, z) < r - 0.01) thickPts.push([y, z]);
    for (const [ty, tz] of [[a / 2, (a * Math.sqrt(3)) / 6], [0, (a * Math.sqrt(3)) / 3]]) {
      if (Math.hypot(y + ty, z + tz) < r - 0.005) thinPts.push([y + ty, z + tz]);
    }
  }
  const thickItems = [];
  for (let k = 0; k < NS; k++) for (const [y, z] of thickPts) thickItems.push({ y: D.y + y, z: D.z + z, k, anchor: 1, dx: 0 });
  const thinItems = [];
  for (let k = 0; k <= NS; k++) for (const side of [-1, 1]) {
    if ((k === 0 && side < 0) || (k === NS && side > 0)) continue;
    for (const [y, z] of thinPts) thinItems.push({ y: D.y + y, z: D.z + z, k, anchor: 0, dx: (side * thin) / 2 });
  }
  const thickMesh = sarcInstances(along(new THREE.CylinderGeometry(0.0075, 0.0075, thick, 6, 1)), thickItems);
  thickMesh.material = fiberMaterial(new THREE.MeshStandardMaterial({ color: '#c0392b', roughness: 0.5 }), { sarc: true, key: 'thick' });
  const thinMesh = sarcInstances(along(new THREE.CylinderGeometry(0.0035, 0.0035, thin, 5, 1)), thinItems);
  thinMesh.material = fiberMaterial(new THREE.MeshStandardMaterial({ color: '#7fc8a9', roughness: 0.5 }), { sarc: true, key: 'thin' });
  const zItems = Array.from({ length: NS + 1 }, (_, k) => ({ y: D.y, z: D.z, k, anchor: 0, dx: 0 }));
  const zMesh = sarcInstances(along(new THREE.CylinderGeometry(r, r, 0.05, 32, 1)), zItems);
  zMesh.material = fiberMaterial(new THREE.MeshStandardMaterial({ color: '#e8e2d0', roughness: 0.7, transparent: true, opacity: 0.55, depthWrite: false }), { sarc: true, key: 'zdisc' });
  group.add(thickMesh, thinMesh, zMesh);

  // Myosin heads on the thick filaments facing the viewer (the cut face is at z = 0): one point per head pair.
  const heads: number[] = [], headSarc: number[] = [], headDir: number[] = [];
  const crown = 0.0143; // 14.3 nm between crowns
  const rr = rng2(5);
  for (const [y, z] of thickPts) {
    if (z < r - 0.12) continue;
    for (let k = 0; k < NS; k++) {
      for (let x = -thick / 2 + 0.02; x < thick / 2 - 0.02; x += crown) {
        if (Math.abs(x) < bare / 2) continue;
        for (let c = 0; c < 3; c++) {
          const ang = ((x / crown) * 40 + c * 120) * (Math.PI / 180);
          heads.push(0, D.y + y + Math.cos(ang) * 0.0075, D.z + z + Math.sin(ang) * 0.0075);
          headSarc.push(k, 1, x);
          headDir.push(Math.cos(ang), Math.sin(ang), rr());
        }
      }
    }
  }
  const headGeo = new THREE.BufferGeometry();
  headGeo.setAttribute('position', new THREE.Float32BufferAttribute(heads, 3));
  headGeo.setAttribute('aSarc', new THREE.Float32BufferAttribute(headSarc, 3));
  headGeo.setAttribute('aHead', new THREE.Float32BufferAttribute(headDir, 3));
  const headPts = new THREE.Points(headGeo, fiberMaterial(new THREE.PointsMaterial({ color: '#7a2a20', size: 0.009, sizeAttenuation: true }), { sarc: true, heads: true, key: 'heads' }));
  headPts.frustumCulled = false;
  headPts.raycast = () => {};
  group.add(headPts);

  // Triads at each A-I junction (mammals): a T-tubule flanked by two SR terminal cisternae.
  const tItems = [], tcItems = [];
  for (const p of LAYOUT.nearCut) for (let k = 0; k < NS; k++) for (const side of [-1, 1]) {
    const dx = (side * thick) / 2;
    tItems.push({ y: p.y, z: p.z, k, anchor: 1, dx });
    tcItems.push({ y: p.y, z: p.z, k, anchor: 1, dx: dx - 0.085 }, { y: p.y, z: p.z, k, anchor: 1, dx: dx + 0.085 });
  }
  const tMesh = sarcInstances(along(new THREE.TorusGeometry(r + 0.03, 0.02, 4, 16), RING_AXIS), tItems);
  tMesh.material = fiberMaterial(new THREE.MeshStandardMaterial({ color: '#3b6fd8', roughness: 0.4 }), { sarc: true, key: 'ttub' });
  const tcMesh = sarcInstances(along(new THREE.TorusGeometry(r + 0.05, 0.045, 5, 16), RING_AXIS), tcItems);
  tcMesh.material = fiberMaterial(new THREE.MeshStandardMaterial({ color: '#9fd3e6', roughness: 0.4, transparent: true, opacity: 0.85 }), { sarc: true, key: 'cist' });
  group.add(tMesh, tcMesh);

  // Intermyofibrillar mitochondria: in the I band, one on each side of the Z-disc, in the gaps between fibrils.
  const mr = rng2(9);
  const mitoItems = [];
  for (const g of LAYOUT.gaps) for (let k = 0; k <= NS; k++) for (const side of [-1, 1]) {
    if ((k === 0 && side < 0) || (k === NS && side > 0) || mr() > 0.7) continue;
    mitoItems.push({ y: g.y, z: g.z, k, anchor: 0, dx: side * 0.3, s: [0.17, 0.25, 0.25] as [number, number, number] });
  }
  const mitoMesh = sarcInstances(new THREE.IcosahedronGeometry(1, 1), mitoItems);
  mitoMesh.material = fiberMaterial(new THREE.MeshStandardMaterial({ color: '#f08a4b', roughness: 0.5 }), { sarc: true, key: 'mito' });
  group.add(mitoMesh);

  // Peripheral nuclei, flattened under the membrane, with subsarcolemmal mitochondria near them.
  const nucMat = fiberMaterial(new THREE.MeshStandardMaterial({ color: '#7b68c9', roughness: 0.6 }), { key: 'nuc' });
  const nucleus = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 24, 12), nucMat, LAYOUT.nuclei.length);
  const ssm: THREE.Matrix4[] = [];
  const sr = rng2(13);
  LAYOUT.nuclei.forEach((nu, i) => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), nu.angle);
    nucleus.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(nu.x, nu.y, nu.z), q, new THREE.Vector3(5, 0.9, 1.7)));
    for (let j = 0; j < 40; j++) {
      const ang = nu.angle + (sr() - 0.5) * 0.35;
      const rad = R - 0.5 - sr() * 0.5;
      const pos = new THREE.Vector3(nu.x + (sr() - 0.5) * 14, Math.cos(ang) * rad, Math.sin(ang) * rad);
      const qq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ang);
      ssm.push(new THREE.Matrix4().compose(pos, qq, new THREE.Vector3(0.5, 0.25, 0.35)));
    }
  });
  nucleus.raycast = () => {};
  const ssmMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mitoMesh.material, ssm.length);
  ssm.forEach((mm, i) => ssmMesh.setMatrixAt(i, mm));
  ssmMesh.material = fiberMaterial(new THREE.MeshStandardMaterial({ color: '#f08a4b', roughness: 0.5 }), { key: 'ssm' });
  ssmMesh.raycast = () => {};
  group.add(nucleus, ssmMesh);

  // The plasma membrane (sarcolemma), coloured by its potential.
  const memMat = fiberMaterial(new THREE.MeshStandardMaterial({ color: '#9fc6dc', roughness: 0.3, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }), { key: 'mem' });
  const membrane = new THREE.Mesh(along(new THREE.CylinderGeometry(R + 0.05, R + 0.05, L0, 128, 1, true)), memMat);
  membrane.raycast = () => {};
  group.add(membrane);

  return {
    group,
    memMat: memMat as THREE.MeshStandardMaterial,
    tMat: tMesh.material as THREE.MeshStandardMaterial,
    tcMat: tcMesh.material as THREE.MeshStandardMaterial,
    detailedAt: new THREE.Vector3(L0 * 0.08, D.y, D.z + 0.6),
  };
}

function rng2(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

const MEM_REST = new THREE.Color('#9fc6dc');
const MEM_FIRE = new THREE.Color('#ff6b4a');
const T_REST = new THREE.Color('#3b6fd8');
const T_FIRE = new THREE.Color('#ff8a5c');
const TC_FULL = new THREE.Color('#9fd3e6');
const TC_RELEASE = new THREE.Color('#ffc94d');

export function MuscleScene() {
  const fiber = useMemo(buildFiber, []);
  const groupRef = useRef<THREE.Group>(null);
  const caSRRest = useRef<number | null>(null);
  useFrame((state) => {
    const s = muscle.latest;
    const view = getMuscleView();
    fiberU.uCut.value = view.cut ? 1 : 0;
    fiberU.uTime.value = state.clock.elapsedTime;
    if (!s) return;
    const f = THREE.MathUtils.clamp(s.force, 0, 1);
    const sl = view.isometric ? FIBER.slRest : FIBER.slRest - (FIBER.slRest - FIBER.slShort) * f;
    fiberU.uSL.value = sl;
    fiberU.uCa.value = THREE.MathUtils.clamp((s.ca - 0.3) / 3, 0, 1);
    fiberU.uV.value = s.v;
    fiberU.uVT.value = s.vT;
    fiberU.uAttached.value = 0.35 * f; // illustrative share of heads attached at full force
    // Volume is kept: a fibre that shortens gets thicker.
    const sx = sl / FIBER.slRest;
    groupRef.current?.scale.set(sx, 1 / Math.sqrt(sx), 1 / Math.sqrt(sx));
    const dep = THREE.MathUtils.clamp((s.v + 82) / 100, 0, 1);
    fiber.memMat.color.copy(MEM_REST).lerp(MEM_FIRE, dep);
    fiber.memMat.opacity = 0.28 + 0.3 * dep;
    fiber.tMat.color.copy(T_REST).lerp(T_FIRE, THREE.MathUtils.clamp((s.vT + 82) / 100, 0, 1));
    if (caSRRest.current === null || s.t < 1) caSRRest.current = s.caSR;
    const released = THREE.MathUtils.clamp(1 - s.caSR / caSRRest.current, 0, 1);
    fiber.tcMat.color.copy(TC_FULL).lerp(TC_RELEASE, Math.min(1, released * 4));
  });
  return (
    <group ref={groupRef}>
      <primitive object={fiber.group} />
      <Html position={fiber.detailedAt} center distanceFactor={60} zIndexRange={[5, 0]}>
        <div className="scene-label">这一根肌原纤维逐根画出了粗、细肌丝，放大看</div>
      </Html>
    </group>
  );
}
