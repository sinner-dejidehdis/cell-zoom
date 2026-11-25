// Wheel zoom for the single-scene pages (muscle, neuron), working like the beta-cell page: each notch
// scales the view about the point under the cursor (the surface hit there, or a point on the cursor ray),
// so you can keep zooming into whatever you point at. OrbitControls' own zoom moves only towards its
// orbit target and stops at minDistance, which is why zooming into a spot away from the target stalled.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface Controls { target: THREE.Vector3; update(): void }

export function WheelZoom({ minDistance = 0.005, maxDistance = 6000, accept }: {
  minDistance?: number;
  maxDistance?: number;
  /** Return false for hits that are not drawn (e.g. inside a cut-away part). */
  accept?: (hit: THREE.Intersection) => boolean;
}) {
  const { gl, camera, scene, controls } = useThree() as unknown as { gl: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; scene: THREE.Scene; controls: Controls | null };
  const pending = useRef(0);
  const pivot = useRef(new THREE.Vector3());
  useEffect(() => {
    const el = gl.domElement;
    const ray = new THREE.Raycaster();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!controls) return;
      let dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
      if (e.ctrlKey) dy *= 4; // trackpad pinch
      dy = THREE.MathUtils.clamp(dy, -250, 250);
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const dist = camera.position.distanceTo(controls.target);
      ray.params.Line = { threshold: dist * 0.003 };
      ray.params.Points = { threshold: dist * 0.003 };
      // Prefer a surface; thin lines and points (skeletons, markers) only when no surface is under the cursor,
      // since they run inside the tubes and zooming onto them would end up inside.
      const hits = ray.intersectObjects(scene.children, true).filter((h) => h.object.visible && (!accept || accept(h)));
      const solid = (h: THREE.Intersection) => !(h.object instanceof THREE.Line || h.object instanceof THREE.Points);
      const hit = hits.find(solid) ?? hits[0];
      pivot.current.copy(hit ? hit.point : ray.ray.at(dist, new THREE.Vector3()));
      pending.current += dy * 0.0016;
    };
    el.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, [gl, camera, scene, controls, accept]);

  useFrame((_, dt) => {
    if (!controls || Math.abs(pending.current) < 1e-4) return;
    // Apply the requested zoom smoothly over about 0.15 s.
    const step = pending.current * Math.min(1, dt * 12);
    pending.current -= step;
    let f = Math.exp(step);
    const P = pivot.current;
    const d = camera.position.distanceTo(P);
    if (d * f < minDistance) f = minDistance / d;
    if (camera.position.distanceTo(controls.target) * f > maxDistance) f = 1;
    camera.position.sub(P).multiplyScalar(f).add(P);
    controls.target.sub(P).multiplyScalar(f).add(P);
    controls.update();
  });
  return null;
}
