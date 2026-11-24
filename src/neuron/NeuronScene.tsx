// The pyramidal neuron in 3-D: every compartment coloured by its membrane potential from the model, the
// 300 input synapses flashing when they release, and one synapse drawn at nanometre scale.
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { neuron } from '../sim/neuron/client';
import { SYN } from '../sim/neuron/model';
import {
  BOUTONS, buildAxon, buildDendrites, CELL, FEATURED, featuredFrame, NC, Q, S_BOUTON_BOTTOM, S_BOUTON_CENTER, S_TOP_HEAD,
  SYNAPSE, voltMaterial, voltTex, withComp,
} from './geometry';

// Labels stay mounted and are hidden with CSS: unmounting drei's Html while the scene renders can throw.
function Label({ position, children, hidden = false }: { position: [number, number, number] | THREE.Vector3; children: React.ReactNode; hidden?: boolean }) {
  return (
    <Html position={position} center zIndexRange={[5, 0]}>
      <div className="scene-label" style={hidden ? { display: 'none' } : undefined}>{children}</div>
    </Html>
  );
}

/** Peak-normalised synaptic conductance waveform (difference of exponentials). */
const tPeak = (SYN.tauRise * SYN.tauDecay / (SYN.tauDecay - SYN.tauRise)) * Math.log(SYN.tauDecay / SYN.tauRise);
const gNorm = 1 / (Math.exp(-tPeak / SYN.tauDecay) - Math.exp(-tPeak / SYN.tauRise));
const gShape = (age: number) => (age < 0 ? 0 : gNorm * (Math.exp(-age / SYN.tauDecay) - Math.exp(-age / SYN.tauRise)));

function hash(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function Cell() {
  const dend = useMemo(buildDendrites, []);
  const ax = useMemo(buildAxon, []);
  const mats = useMemo(() => ({
    tube: voltMaterial(new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 }), 'tube'),
    line: voltMaterial(new THREE.LineBasicMaterial({ transparent: true, opacity: 0.75 }), 'line', 1, false),
    myelin: voltMaterial(new THREE.MeshStandardMaterial({ color: '#efe6d2', roughness: 0.45 }), 'myelin', 0.2),
    soma: voltMaterial(new THREE.MeshStandardMaterial({ roughness: 0.55 }), 'soma'),
    term: voltMaterial(new THREE.MeshStandardMaterial({ roughness: 0.5 }), 'term'),
  }), []);
  const soma = useMemo(() => withComp(new THREE.SphereGeometry(1, 32, 20), 0), []);
  const bouton = useMemo(() => withComp(new THREE.SphereGeometry(0.6, 12, 8), CELL.axonEnd), []);
  return (
    <>
      <mesh geometry={dend.mesh} material={mats.tube} />
      <lineSegments geometry={dend.skeleton} material={mats.line} />
      <mesh geometry={ax.axon} material={mats.tube} />
      <lineSegments geometry={ax.axonLines} material={mats.line} />
      <mesh geometry={ax.myelin} material={mats.myelin} />
      <mesh geometry={ax.terminals} material={mats.term} />
      <lineSegments geometry={ax.terminalLines} material={mats.line} />
      {ax.boutons.map((p, i) => <mesh key={i} position={p} geometry={bouton} material={mats.term} />)}
      {/* Soma: the model's soma is a 25 x 35 um cylinder; drawn as an ellipsoid of that size along the apical axis. */}
      <mesh geometry={soma} material={mats.soma} quaternion={Q.clone().invert()} scale={[12.5, 17.5, 12.5]} />
    </>
  );
}

/** The input synapses: small boutons on the dendrites that light up when they release a vesicle. */
function Inputs() {
  const n = BOUTONS.length;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const pts = useRef<THREE.Points>(null);
  const { geo, ptsGeo } = useMemo(() => {
    const geo = new THREE.SphereGeometry(0.5, 10, 8);
    const pos = new Float32Array(n * 3);
    BOUTONS.forEach((b, i) => {
      const p = b.center.clone().addScaledVector(b.dir, b.r + 0.55);
      pos.set([p.x, p.y, p.z], i * 3);
    });
    const ptsGeo = new THREE.BufferGeometry();
    ptsGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    ptsGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    return { geo, ptsGeo };
  }, [n]);
  const init = useRef(false);
  const base = new THREE.Color('#3c5a3c'), lit = new THREE.Color('#b8ff7a'), col = new THREE.Color();
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    if (!init.current) {
      const o = new THREE.Object3D();
      BOUTONS.forEach((b, i) => {
        o.position.copy(b.center).addScaledVector(b.dir, b.r + 0.45);
        o.scale.setScalar(i === FEATURED ? 0 : 1); // the featured one is drawn in detail
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
      });
      m.instanceMatrix.needsUpdate = true;
      init.current = true;
    }
    const now = neuron.latest?.t ?? 0;
    const glow = new Float32Array(n);
    for (const [i, t] of neuron.releases) glow[i] = Math.max(glow[i], Math.exp(-Math.max(0, now - t) / 1.5));
    const colors = ptsGeo.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      col.copy(base).lerp(lit, glow[i]);
      m.setColorAt(i, col);
      colors.setXYZ(i, col.r, col.g, col.b);
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    colors.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={mesh} args={[geo, undefined, n]}>
        <meshStandardMaterial roughness={0.5} emissive="#2c6a1c" emissiveIntensity={0.4} />
      </instancedMesh>
      <points ref={pts} geometry={ptsGeo}>
        <pointsMaterial vertexColors size={3} sizeAttenuation={false} transparent opacity={0.9} depthWrite={false} />
      </points>
    </>
  );
}

const VESICLES = 120, DOCKED = 8, GLU_PER = 80, GLU_EVENTS = 4;
/** Effective glutamate diffusion in and around the cleft, um2/ms: illustrative. */
const D_GLU = 0.3;
/** Time to re-dock a vesicle after fusion, ms of model time: illustrative. */
const REFILL = 800;
const RECEPTORS = 18;

/** One synapse at its real size: bouton with vesicles, 20 nm cleft, spine with receptors. */
function FeaturedSynapse({ showLabels }: { showLabels: boolean }) {
  const f = useMemo(featuredFrame, []);
  const comp = BOUTONS[FEATURED].comp;
  const S = SYNAPSE;
  const geo = useMemo(() => {
    const headTheta = Math.asin(S.capR / S.headR);
    const head = withComp(new THREE.SphereGeometry(S.headR, 32, 20, 0, Math.PI * 2, headTheta, Math.PI - headTheta), comp);
    const neck = withComp(new THREE.CylinderGeometry(S.neckR, S.neckR * 1.2, S.neckTop + 0.05, 16), comp);
    const bTheta = Math.PI - Math.asin(S.boutonCap / S.boutonR);
    const bouton = new THREE.SphereGeometry(S.boutonR, 40, 24, 0, Math.PI * 2, 0, bTheta);
    const cap = new THREE.CircleGeometry(S.boutonCap, 32).rotateX(Math.PI / 2);
    const psd = new THREE.CylinderGeometry(S.capR * 0.95, S.capR * 0.95, S.psdT, 32);
    const headCap = withComp(new THREE.CircleGeometry(S.capR, 32).rotateX(-Math.PI / 2), comp);
    return { head, neck, bouton, cap, psd, headCap };
  }, [comp, S]);
  const mats = useMemo(() => ({
    spine: voltMaterial(new THREE.MeshStandardMaterial({ roughness: 0.6 }), 'spine'),
  }), []);

  // Vesicles: random in the bouton, plus a docked row on the active zone.
  const ves = useMemo(() => {
    const out: { p: THREE.Vector3; docked: boolean }[] = [];
    let k = 1;
    for (let i = 0; i < DOCKED; i++) {
      const a = (i / DOCKED) * Math.PI * 2 + 0.3, r = 0.05 + 0.07 * hash(i + 3);
      out.push({ p: new THREE.Vector3(Math.cos(a) * r, S_BOUTON_BOTTOM + S.vesicleR + 0.003, Math.sin(a) * r), docked: true });
    }
    while (out.length < VESICLES) {
      const p = new THREE.Vector3(hash(k++) - 0.5, hash(k++) - 0.5, hash(k++) - 0.5).multiplyScalar(0.8);
      const q = p.clone().add(new THREE.Vector3(0, S_BOUTON_CENTER, 0));
      if (p.length() > S.boutonR - 0.04 || q.y < S_BOUTON_BOTTOM + 0.07) continue;
      if (out.some((o) => o.p.distanceTo(q) < 2.1 * S.vesicleR)) continue;
      out.push({ p: q, docked: false });
    }
    return out;
  }, [S]);
  const vesMesh = useRef<THREE.InstancedMesh>(null);
  const recMesh = useRef<THREE.InstancedMesh>(null);
  const glu = useRef<THREE.Points>(null);
  const state = useRef({ fusedAt: new Array(DOCKED).fill(-1e9) as number[], seen: new Set<string>(), events: [] as { t: number; x: number; z: number }[], lastT: 0 });
  const gluGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GLU_PER * GLU_EVENTS * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(GLU_PER * GLU_EVENTS * 3), 3));
    return g;
  }, []);
  const recPos = useMemo(() => Array.from({ length: RECEPTORS }, (_, i) => {
    const a = i * 2.399, r = Math.sqrt((i + 0.5) / RECEPTORS) * S.capR * 0.8;
    return new THREE.Vector3(Math.cos(a) * r, S_TOP_HEAD + 0.004, Math.sin(a) * r);
  }), [S]);
  const o = useMemo(() => new THREE.Object3D(), []);
  const c = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const now = neuron.latest?.t ?? 0;
    const st = state.current;
    if (now < st.lastT) { st.fusedAt.fill(-1e9); st.events = []; st.seen.clear(); }
    st.lastT = now;
    // New releases at this synapse: fuse a docked vesicle and start a cloud of transmitter.
    let g = 0;
    for (const [i, t] of neuron.releases) {
      if (i !== FEATURED) continue;
      g += gShape(now - t);
      const key = t.toFixed(4);
      if (st.seen.has(key)) continue;
      st.seen.add(key);
      let k = st.fusedAt.findIndex((x) => t - x > REFILL);
      if (k < 0) k = 0;
      st.fusedAt[k] = t;
      st.events.push({ t, x: ves[k].p.x, z: ves[k].p.z });
      if (st.events.length > GLU_EVENTS) st.events.shift();
    }
    if (st.seen.size > 200) st.seen.clear();
    const vm = vesMesh.current, rm = recMesh.current;
    if (vm) {
      ves.forEach((v, i) => {
        let s = 1;
        const dy = 0;
        if (v.docked) {
          const age = now - st.fusedAt[i];
          if (age >= 0 && age < REFILL) {
            s = age < 0.3 ? 1 - age / 0.3 : age > REFILL - 60 ? (age - (REFILL - 60)) / 60 : 0;
          }
        }
        o.position.set(v.p.x, v.p.y + dy, v.p.z);
        o.scale.setScalar(Math.max(0.001, s));
        o.updateMatrix();
        vm.setMatrixAt(i, o.matrix);
      });
      vm.instanceMatrix.needsUpdate = true;
    }
    // Receptors: the share that are open follows the synaptic conductance of this synapse.
    if (rm) {
      const open = Math.min(1, g);
      recPos.forEach((p, i) => {
        o.position.copy(p);
        o.scale.setScalar(1);
        o.updateMatrix();
        rm.setMatrixAt(i, o.matrix);
        c.set(hash(i * 7 + 1) < open ? '#b8ff7a' : '#7a4a58');
        rm.setColorAt(i, c);
      });
      rm.instanceMatrix.needsUpdate = true;
      if (rm.instanceColor) rm.instanceColor.needsUpdate = true;
    }
    // Transmitter: diffuses out of the cleft within about a millisecond.
    const pos = gluGeo.attributes.position as THREE.BufferAttribute;
    const col = gluGeo.attributes.color as THREE.BufferAttribute;
    for (let e = 0; e < GLU_EVENTS; e++) {
      const ev = st.events[e];
      const age = ev ? now - ev.t - 0.15 : -1;
      for (let j = 0; j < GLU_PER; j++) {
        const idx = e * GLU_PER + j;
        if (!ev || age < 0 || age > 3) { pos.setXYZ(idx, 0, -10, 0); col.setXYZ(idx, 0, 0, 0); continue; }
        const th = hash(idx * 3 + 1) * Math.PI * 2;
        const ray = Math.sqrt(-2 * Math.log(Math.max(1e-6, hash(idx * 3 + 2))));
        const r = Math.sqrt(2 * D_GLU * age) * ray;
        const u = hash(idx * 3 + 3);
        const out = Math.max(0, Math.hypot(ev.x + Math.cos(th) * r, ev.z + Math.sin(th) * r) - S.capR);
        const y = S_TOP_HEAD + S.cleft * (0.15 + 0.7 * u) + (u - 0.5) * out * 1.6;
        pos.setXYZ(idx, ev.x + Math.cos(th) * r, y, ev.z + Math.sin(th) * r);
        const fade = Math.max(0, 1 - age / 3);
        col.setXYZ(idx, fade, 0.85 * fade, 0.3 * fade);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });

  const vesGeo = useMemo(() => new THREE.SphereGeometry(S.vesicleR, 12, 8), [S]);
  const recGeo = useMemo(() => new THREE.CylinderGeometry(0.006, 0.006, 0.012, 8), []);
  return (
    <group position={f.origin} quaternion={f.local}>
      <mesh geometry={geo.neck} material={mats.spine} position={[0, (S.neckTop - 0.05) / 2, 0]} />
      <mesh geometry={geo.head} material={mats.spine} position={[0, S.headY, 0]} />
      <mesh geometry={geo.headCap} material={mats.spine} position={[0, S_TOP_HEAD, 0]} />
      <mesh geometry={geo.psd} position={[0, S_TOP_HEAD - S.psdT / 2 + 0.002, 0]}>
        <meshStandardMaterial color="#4a1822" roughness={0.8} />
      </mesh>
      <instancedMesh ref={recMesh} args={[recGeo, undefined, RECEPTORS]}>
        <meshStandardMaterial roughness={0.4} emissive="#244a18" emissiveIntensity={0.5} />
      </instancedMesh>
      <mesh geometry={geo.bouton} position={[0, S_BOUTON_CENTER, 0]}>
        <meshStandardMaterial color="#9fb6d8" transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} roughness={0.4} />
      </mesh>
      <mesh geometry={geo.cap} position={[0, S_BOUTON_BOTTOM, 0]}>
        <meshStandardMaterial color="#9fb6d8" transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <instancedMesh ref={vesMesh} args={[vesGeo, undefined, VESICLES]}>
        <meshStandardMaterial color="#e6ecff" roughness={0.3} emissive="#334" />
      </instancedMesh>
      <points ref={glu} geometry={gluGeo}>
        <pointsMaterial vertexColors size={0.012} sizeAttenuation transparent blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
      <Label hidden={!showLabels} position={[0.5, S_BOUTON_CENTER + 0.3, 0]}>突触前末梢（直径约 0.8 µm，示意）</Label>
      <Label hidden={!showLabels} position={[-0.45, S_BOUTON_CENTER + 0.05, 0]}>突触小泡 直径 40 nm</Label>
      <Label hidden={!showLabels} position={[0.42, S_TOP_HEAD + 0.01, 0]}>突触间隙 约 20 nm</Label>
      <Label hidden={!showLabels} position={[-0.42, S_TOP_HEAD - 0.03, 0]}>受体（AMPA 型）</Label>
      <Label hidden={!showLabels} position={[0.38, S.headY - 0.1, 0]}>树突棘</Label>
      <Label hidden={!showLabels} position={[-0.3, 0.1, 0]}>树突</Label>
    </group>
  );
}

export function NeuronScene() {
  const camera = useThree((s) => s.camera);
  const [near, setNear] = useState<'far' | 'synapse'>('far');
  const fc = useMemo(featuredFrame, []);
  useFrame(() => {
    const s = neuron.latest;
    if (s && s.v.length === NC) {
      (voltTex.image.data as Float32Array).set(s.v);
      voltTex.needsUpdate = true;
    }
    const want = camera.position.distanceTo(fc.centerW) < 8 ? 'synapse' : 'far';
    if (want !== near) setNear(want);
  });
  const ap = new THREE.Vector3(...CELL.apical);
  const ax = new THREE.Vector3(...CELL.axonDir);
  return (
    <group quaternion={Q}>
      <Cell />
      <Inputs />
      <FeaturedSynapse showLabels={near === 'synapse'} />
          <Label hidden={near !== 'far'} position={new THREE.Vector3(-30, 8, 0).applyQuaternion(Q.clone().invert())}>胞体</Label>
          <Label hidden={near !== 'far'} position={ap.clone().multiplyScalar(420)}>顶树突</Label>
          <Label hidden={near !== 'far'} position={ax.clone().multiplyScalar(18).add(new THREE.Vector3(14, 0, 0).applyQuaternion(Q.clone().invert()))}>轴丘、轴突始段</Label>
          <Label hidden={near !== 'far'} position={ax.clone().multiplyScalar(300).add(new THREE.Vector3(10, 0, 0).applyQuaternion(Q.clone().invert()))}>轴突（髓鞘 + 郎飞结）</Label>
    </group>
  );
}
