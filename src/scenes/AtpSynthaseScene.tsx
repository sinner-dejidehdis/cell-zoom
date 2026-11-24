import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { anchorCenters } from '../engine/anchors';
import { getData, type Structure } from '../engine/data';
import { inPocket, withPocket } from '../engine/pocket';
import { getSim, useSim } from '../engine/store';
import type { SceneProps } from './types';


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

/**
 * Space-filling atoms, drawn as instanced spheres. `origin` is subtracted from every atom position.
 * Ray casting tests the atom spheres directly (fast enough for 39,000 atoms; a triangle test is not),
 * and skips atoms that the pocket around the catalytic site is hiding.
 */
function AtomCloud({ s, indices, origin }: { s: Structure; indices: number[]; origin: THREE.Vector3 }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const local = useMemo(() => {
    const centres = new Float32Array(indices.length * 3);
    const radii = new Float32Array(indices.length);
    indices.forEach((a, i) => {
      centres[i * 3] = s.pos[a * 3] - origin.x;
      centres[i * 3 + 1] = s.pos[a * 3 + 1] - origin.y;
      centres[i * 3 + 2] = s.pos[a * 3 + 2] - origin.z;
      radii[i] = VDW[s.meta.elements[s.element[a]]] ?? 1.7;
    });
    return { centres, radii };
  }, [s, indices, origin]);

  useLayoutEffect(() => {
    const mesh = ref.current!;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    indices.forEach((a, i) => {
      const el = s.meta.elements[s.element[a]];
      const r = local.radii[i];
      m.makeScale(r, r, r).setPosition(local.centres[i * 3], local.centres[i * 3 + 1], local.centres[i * 3 + 2]);
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
  }, [s, indices, local]);

  const material = useMemo(() => withPocket(new THREE.MeshStandardMaterial({ roughness: 0.55 })), []);

  const raycast = useMemo(() => {
    const inv = new THREE.Matrix4();
    const ray = new THREE.Ray();
    const toC = new THREE.Vector3();
    return function (this: THREE.InstancedMesh, raycaster: THREE.Raycaster, hits: THREE.Intersection[]) {
      inv.copy(this.matrixWorld).invert();
      ray.copy(raycaster.ray).applyMatrix4(inv);
      const { centres, radii } = local;
      let best = Infinity;
      let bestI = -1;
      const scratch = new THREE.Vector3();
      for (let i = 0; i < radii.length; i++) {
        toC.set(centres[i * 3] - ray.origin.x, centres[i * 3 + 1] - ray.origin.y, centres[i * 3 + 2] - ray.origin.z);
        const tc = toC.dot(ray.direction);
        if (tc < 0) continue;
        const d2 = toC.lengthSq() - tc * tc;
        const r = radii[i];
        if (d2 > r * r) continue;
        const t = tc - Math.sqrt(r * r - d2);
        if (t <= 0 || t >= best) continue;
        scratch.set(centres[i * 3], centres[i * 3 + 1], centres[i * 3 + 2]).applyMatrix4(this.matrixWorld);
        if (inPocket(scratch)) continue;
        best = t;
        bestI = i;
      }
      if (bestI < 0) return;
      const point = ray.at(best, new THREE.Vector3()).applyMatrix4(this.matrixWorld);
      hits.push({ distance: point.distanceTo(raycaster.ray.origin), point, object: this, instanceId: bestI } as THREE.Intersection);
    };
  }, [local]);

  return (
    <instancedMesh ref={ref} args={[undefined, material, indices.length]} raycast={raycast}>
      <icosahedronGeometry args={[1, 1]} />
    </instancedMesh>
  );
}

export function AtpSynthaseScene({ role, hidden, hover }: SceneProps) {
  const s = getData().atp;
  const sim = useSim();

  const parts = useMemo(() => {
    const stator: number[] = [];
    const rotor: number[] = [];
    const inhibitor: number[] = [];
    for (let a = 0; a < s.meta.atomCount; a++) {
      const g = s.group[a];
      if (g === s.meta.groups.rotor) rotor.push(a);
      else if (g === s.meta.groups.inhibitor) inhibitor.push(a);
      else stator.push(a);
    }
    return { stator, rotor, inhibitor };
  }, [s]);

  const rotorRef = useRef<THREE.Group>(null);
  const turn = useRef(0); // seconds of animation time accumulated while playing
  useFrame((_, dt) => {
    if (!rotorRef.current) return;
    if (getSim().playing && role !== 'child') turn.current += Math.min(dt, 0.1);
    const step = Math.floor(turn.current / STEP_SECONDS);
    const frac = Math.min(1, (turn.current / STEP_SECONDS - step) / STEP_MOVE);
    const eased = frac * frac * (3 - 2 * frac);
    // Positive angle about the c-ring -> head axis: clockwise seen from the membrane, the ATP-synthesis direction.
    const angle = ((step + eased) * 2 * Math.PI) / 3;
    rotorRef.current.quaternion.setFromAxisAngle(s.axisDir, angle);
  });

  const site = anchorCenters('atp-synthase')[0];
  const showBeacon = role === 'current' && hidden !== 0;

  // Own frame: c-ring centre at the origin, rotation axis along +Y (see anchors.ts).
  return (
    <group>
      <group quaternion={s.align}>
        <AtomCloud s={s} indices={parts.stator} origin={s.axisOrigin} />
        {sim.showInhibitor && <AtomCloud s={s} indices={parts.inhibitor} origin={s.axisOrigin} />}
        <group ref={rotorRef}>
          <AtomCloud s={s} indices={parts.rotor} origin={s.axisOrigin} />
        </group>
      </group>
      <mesh position={site} renderOrder={10} visible={showBeacon} userData={{ anchorLevel: 'atp-synthase', anchorIndex: 0, pivotPriority: true }}>
        <sphereGeometry args={[9, 24, 16]} />
        <meshStandardMaterial
          color="#7dffb0"
          emissive="#3dff8a"
          emissiveIntensity={hover === 0 ? 1.2 : 0.6}
          transparent
          opacity={hover === 0 ? 0.75 : 0.45}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
    </group>
  );
}
