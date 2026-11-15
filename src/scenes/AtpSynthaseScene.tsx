import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { getSim, useSim } from '../engine/store';
import type { SceneProps } from './types';
import { asset } from './util';

interface Meta {
  pdbId: string;
  atomCount: number;
  elements: string[];
  chains: { id: string; subunit: string }[];
  groups: Record<'stator' | 'rotor' | 'inhibitor' | 'ligand', number>;
  site: { chain: string; position: [number, number, number] };
  axis: { origin: [number, number, number]; direction: [number, number, number] };
}

interface Structure {
  meta: Meta;
  pos: Float32Array;
  element: Uint8Array;
  chain: Uint8Array;
  group: Uint8Array;
}

// Van der Waals radii in angstrom (Bondi), for the space-filling view.
const VDW: Record<string, number> = { C: 1.7, N: 1.55, O: 1.52, S: 1.8, P: 1.8, MG: 1.73 };

// Colours by subunit: warm = stays still (stator), cool = turns (rotor).
const SUBUNIT_COLOR: Record<string, string> = {
  alpha: '#e9a27c', beta: '#cf5d68',
  gamma: '#2fb3a8', delta: '#4a9fd8', epsilon: '#7cc9e6', c: '#2a7f99',
  b: '#d6bd78', d: '#d6bd78', F6: '#d6bd78', OSCP: '#c9a85c',
  a: '#a48bc6', e: '#a48bc6', f: '#a48bc6', g: '#a48bc6', A6L: '#a48bc6', ATP5MJ: '#a48bc6',
  IF1: '#9aa0a6',
};
const LIGAND_COLOR: Record<string, string> = { MG: '#8aff4a' };
const ELEMENT_SHADE: Record<string, number> = { C: 1.0, N: 0.82, O: 0.9, S: 1.15, P: 1.1, MG: 1.0 };

const STEP_SECONDS = 1.6; // one 120 degree step, demo speed
const STEP_MOVE = 0.35;   // fraction of a step spent turning; the rest is the dwell

async function load(): Promise<Structure> {
  const [meta, bin] = await Promise.all([
    fetch(asset('data/atp-synthase.json')).then((r) => r.json() as Promise<Meta>),
    fetch(asset('data/atp-synthase.bin')).then((r) => r.arrayBuffer()),
  ]);
  const n = meta.atomCount;
  return {
    meta,
    pos: new Float32Array(bin, 0, n * 3),
    element: new Uint8Array(bin, n * 12, n),
    chain: new Uint8Array(bin, n * 13, n),
    group: new Uint8Array(bin, n * 14, n),
  };
}

function AtomCloud({ s, indices, origin }: { s: Structure; indices: number[]; origin: THREE.Vector3 }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current!;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    indices.forEach((a, i) => {
      const el = s.meta.elements[s.element[a]];
      const r = VDW[el] ?? 1.7;
      m.makeScale(r, r, r).setPosition(s.pos[a * 3] - origin.x, s.pos[a * 3 + 1] - origin.y, s.pos[a * 3 + 2] - origin.z);
      mesh.setMatrixAt(i, m);
      const isLigand = s.group[a] === s.meta.groups.ligand;
      const subunit = s.meta.chains[s.chain[a]].subunit;
      c.set(isLigand ? (LIGAND_COLOR[el] ?? '#ffd84a') : (SUBUNIT_COLOR[subunit] ?? '#bbbbbb'));
      c.multiplyScalar(ELEMENT_SHADE[el] ?? 1);
      mesh.setColorAt(i, c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [s, indices, origin]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, indices.length]} raycast={() => null}>
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial roughness={0.55} />
    </instancedMesh>
  );
}

export function AtpSynthaseScene({ onZoom }: SceneProps) {
  const [s, setS] = useState<Structure | null>(null);
  const sim = useSim();
  useEffect(() => {
    load().then(setS);
  }, []);

  const parts = useMemo(() => {
    if (!s) return null;
    const stator: number[] = [];
    const rotor: number[] = [];
    const inhibitor: number[] = [];
    for (let a = 0; a < s.meta.atomCount; a++) {
      const g = s.group[a];
      if (g === s.meta.groups.rotor) rotor.push(a);
      else if (g === s.meta.groups.inhibitor) inhibitor.push(a);
      else stator.push(a);
    }
    const axisOrigin = new THREE.Vector3(...s.meta.axis.origin);
    const axisDir = new THREE.Vector3(...s.meta.axis.direction).normalize();
    // Stand the enzyme up: membrane part at the bottom, F1 head on top.
    const align = new THREE.Quaternion().setFromUnitVectors(axisDir, new THREE.Vector3(0, 1, 0));
    return { stator, rotor, inhibitor, axisOrigin, axisDir, align, site: new THREE.Vector3(...s.meta.site.position) };
  }, [s]);

  const rotorRef = useRef<THREE.Group>(null);
  const turn = useRef(0); // seconds of animation time accumulated while playing
  useFrame((_, dt) => {
    if (!parts || !rotorRef.current) return;
    if (getSim().playing) turn.current += dt;
    const step = Math.floor(turn.current / STEP_SECONDS);
    const frac = Math.min(1, (turn.current / STEP_SECONDS - step) / STEP_MOVE);
    const eased = frac * frac * (3 - 2 * frac);
    // Positive angle about the c-ring -> head axis: clockwise seen from the membrane, the ATP-synthesis direction.
    const angle = ((step + eased) * 2 * Math.PI) / 3;
    rotorRef.current.quaternion.setFromAxisAngle(parts.axisDir, angle);
  });

  const zero = useMemo(() => new THREE.Vector3(), []);
  const siteRef = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);

  if (!s || !parts) return null;

  return (
    <group quaternion={parts.align}>
      <AtomCloud s={s} indices={parts.stator} origin={zero} />
      {sim.showInhibitor && <AtomCloud s={s} indices={parts.inhibitor} origin={zero} />}
      <group position={parts.axisOrigin}>
        <group ref={rotorRef}>
          <AtomCloud s={s} indices={parts.rotor} origin={parts.axisOrigin} />
        </group>
      </group>
      <mesh
        ref={siteRef}
        position={parts.site}
        renderOrder={10}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = '';
        }}
        onClick={(e) => {
          e.stopPropagation();
          document.body.style.cursor = '';
          onZoom('catalytic-site', siteRef.current!.getWorldPosition(new THREE.Vector3()));
        }}
      >
        <sphereGeometry args={[9, 24, 16]} />
        <meshStandardMaterial
          color="#7dffb0"
          emissive="#3dff8a"
          emissiveIntensity={hover ? 1.2 : 0.6}
          transparent
          opacity={hover ? 0.75 : 0.45}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
    </group>
  );
}
