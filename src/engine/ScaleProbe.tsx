// Computes a scale bar every frame from the camera distance and the level's metres-per-unit.
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { domRefs } from './store';

const NICE = [1, 2, 5];

function format(m: number): string {
  if (m >= 1e-6) return `${+(m / 1e-6).toPrecision(3)} µm`;
  if (m >= 1e-9) return `${+(m / 1e-9).toPrecision(3)} nm`;
  return `${+(m / 1e-10).toPrecision(3)} Å`;
}

export function ScaleProbe({ metersPerUnit }: { metersPerUnit: number }) {
  const { camera, controls, size } = useThree();
  useFrame(() => {
    if (!domRefs.scaleBar || !domRefs.scaleLabel || !(camera instanceof THREE.PerspectiveCamera)) return;
    const ctl = controls as unknown as OrbitControlsImpl | null;
    const target = ctl ? ctl.target : new THREE.Vector3();
    const d = camera.position.distanceTo(target);
    const worldPerPixel = (2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / size.height;
    const metersPerPixel = worldPerPixel * metersPerUnit;
    // Largest 1-2-5 length that fits in 140 px.
    const raw = metersPerPixel * 140;
    const exp = Math.floor(Math.log10(raw));
    let length = Math.pow(10, exp);
    for (const n of NICE) if (n * Math.pow(10, exp) <= raw) length = n * Math.pow(10, exp);
    domRefs.scaleBar.style.width = `${Math.round(length / metersPerPixel)}px`;
    domRefs.scaleLabel.textContent = format(length);
  });
  return null;
}
