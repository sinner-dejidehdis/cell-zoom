import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { LAYOUT } from './fiber';
import { getMuscleView, setMuscleView } from './store';

export type Presets = Record<string, { target: THREE.Vector3; pos: THREE.Vector3 }>;

const D = LAYOUT.detailed;
const MUSCLE_PRESETS: Presets = {
  overview: { target: new THREE.Vector3(0, 0, 0), pos: new THREE.Vector3(30, 62, 98) },
  myofibrils: { target: new THREE.Vector3(3, D.y, D.z), pos: new THREE.Vector3(5.5, D.y + 4, D.z + 7) },
  filaments: { target: new THREE.Vector3(3, D.y, D.z + 0.35), pos: new THREE.Vector3(3.25, D.y + 0.25, D.z + 1.7) },
};

/** Flies the camera to a preset when one is requested. */
export function CameraRig({ presets = MUSCLE_PRESETS, take = takeMuscle, seconds = 1.6 }: { presets?: Presets; take?: () => string | null; seconds?: number }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.Camera; controls: OrbitControlsImpl | null };
  const flight = useRef<{ from: THREE.Vector3; to: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3; u: number } | null>(null);
  useFrame((_, dt) => {
    const want = take();
    if (want && controls) {
      const p = presets[want];
      flight.current = { from: camera.position.clone(), to: p.pos.clone(), t0: controls.target.clone(), t1: p.target.clone(), u: 0 };
    }
    const f = flight.current;
    if (!f || !controls) return;
    f.u = Math.min(1, f.u + dt / seconds);
    const e = f.u * f.u * (3 - 2 * f.u);
    // Move the distance logarithmically, so a 1000x change in scale reads as a steady zoom.
    const d0 = f.from.distanceTo(f.t0), d1 = f.to.distanceTo(f.t1);
    const dist = d0 * Math.pow(d1 / d0, e);
    const target = f.t0.clone().lerp(f.t1, e);
    const dir = f.from.clone().sub(f.t0).normalize().lerp(f.to.clone().sub(f.t1).normalize(), e).normalize();
    controls.target.copy(target);
    camera.position.copy(target).addScaledVector(dir, dist);
    controls.update();
    if (f.u >= 1) flight.current = null;
  });
  return null;
}

function takeMuscle(): string | null {
  const p = getMuscleView().preset;
  if (p) setMuscleView({ preset: null });
  return p;
}
