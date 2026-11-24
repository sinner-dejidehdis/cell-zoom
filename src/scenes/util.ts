import * as THREE from 'three';

export const BASE = import.meta.env.BASE_URL;

declare global {
  interface Window {
    /** Optional map from asset path to URL, for hosts that cannot serve binary files (e.g. a single-page embed). */
    __CELL_ZOOM_ASSETS__?: Record<string, string>;
  }
}

/** URL of a file under public/, e.g. asset('models/cell.glb'). */
export function asset(path: string): string {
  return window.__CELL_ZOOM_ASSETS__?.[path] ?? BASE + path;
}

/** Deterministic random numbers, so the cell looks the same on every visit. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInBall(r: () => number, radius: number): THREE.Vector3 {
  for (;;) {
    const v = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
    if (v.lengthSq() <= 1) return v.multiplyScalar(radius);
  }
}

export function randomQuat(r: () => number): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * Math.PI * 2, r() * Math.PI * 2, r() * Math.PI * 2));
}

/** Make translucent glTF materials see-through from inside and not hide what is behind them. */
export function fixTransparency(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (m.transparent) {
        m.depthWrite = false;
        m.side = THREE.DoubleSide;
        // Zooming aims through see-through shells at what lies behind them.
        mesh.userData.noPivot = true;
      }
    }
  });
}
