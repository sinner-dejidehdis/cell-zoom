// Camera moves between levels: fly towards a clicked structure while fading out,
// then the next level's scene starts zoomed out and flies in while fading in.
// The levels are separate scenes; the motion and the fade make them read as one continuous zoom.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { domRefs } from './store';

export type Entry = 'from-parent' | 'from-child' | 'direct';

interface Move {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  t0: number;
  duration: number;
  fade: 'in' | 'out';
  done?: () => void;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface RigApi {
  flyInto: (point: THREE.Vector3, done: () => void) => void;
  flyOut: (done: () => void) => void;
}

export function CameraRig({
  homeDistance,
  entry,
  apiRef,
}: {
  homeDistance: number;
  entry: Entry;
  apiRef: React.MutableRefObject<RigApi | null>;
}) {
  const { camera, controls, clock } = useThree();
  const move = useRef<Move | null>(null);

  // Entry flight for a freshly mounted level.
  useEffect(() => {
    const dir = new THREE.Vector3(0.35, 0.25, 1).normalize();
    const home = dir.clone().multiplyScalar(homeDistance);
    const start =
      entry === 'from-parent'
        ? dir.clone().multiplyScalar(homeDistance * 0.08)
        : entry === 'from-child'
          ? dir.clone().multiplyScalar(homeDistance * 4)
          : home.clone();
    camera.position.copy(start);
    camera.lookAt(0, 0, 0);
    const near = homeDistance / 2000;
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.near = near;
      camera.far = homeDistance * 50;
      camera.updateProjectionMatrix();
    }
    move.current = {
      fromPos: start,
      toPos: home,
      fromTarget: new THREE.Vector3(),
      toTarget: new THREE.Vector3(),
      t0: clock.getElapsedTime(),
      duration: entry === 'direct' ? 0.6 : 1.3,
      fade: 'in',
    };
  }, [homeDistance, entry, camera, clock]);

  useEffect(() => {
    apiRef.current = {
      flyInto: (point, done) => {
        const ctl = controls as unknown as OrbitControlsImpl | null;
        const target = ctl ? ctl.target.clone() : new THREE.Vector3();
        const toPos = point.clone().add(camera.position.clone().sub(point).normalize().multiplyScalar(homeDistance * 0.02));
        move.current = {
          fromPos: camera.position.clone(), toPos, fromTarget: target, toTarget: point.clone(),
          t0: clock.getElapsedTime(), duration: 1.2, fade: 'out', done,
        };
      },
      flyOut: (done) => {
        const ctl = controls as unknown as OrbitControlsImpl | null;
        const target = ctl ? ctl.target.clone() : new THREE.Vector3();
        const toPos = camera.position.clone().sub(target).multiplyScalar(4).add(target);
        move.current = {
          fromPos: camera.position.clone(), toPos, fromTarget: target, toTarget: target,
          t0: clock.getElapsedTime(), duration: 1.0, fade: 'out', done,
        };
      },
    };
  }, [apiRef, camera, controls, clock, homeDistance]);

  useFrame(() => {
    const m = move.current;
    const ctl = controls as unknown as OrbitControlsImpl | null;
    if (!m) return;
    const t = Math.min(1, (clock.getElapsedTime() - m.t0) / m.duration);
    const k = ease(t);
    camera.position.lerpVectors(m.fromPos, m.toPos, k);
    const target = new THREE.Vector3().lerpVectors(m.fromTarget, m.toTarget, k);
    if (ctl) {
      ctl.enabled = false;
      ctl.target.copy(target);
      ctl.update();
    } else {
      camera.lookAt(target);
    }
    if (domRefs.overlay) {
      // Fade over the last 40 % of an outgoing move, the first 50 % of an incoming one.
      const o = m.fade === 'out' ? Math.max(0, (t - 0.6) / 0.4) : Math.max(0, 1 - t / 0.5);
      domRefs.overlay.style.opacity = String(o);
    }
    if (t >= 1) {
      move.current = null;
      if (ctl) ctl.enabled = true;
      m.done?.();
    }
  });

  return null;
}
