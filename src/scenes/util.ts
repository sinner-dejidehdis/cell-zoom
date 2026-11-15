import * as THREE from 'three';

export const BASE = import.meta.env.BASE_URL;

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
      }
    }
  });
}

/** World position of one instance of an InstancedMesh. */
export function instanceWorldPosition(mesh: THREE.InstancedMesh, id: number): THREE.Vector3 {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(id, m);
  return new THREE.Vector3().setFromMatrixPosition(m).applyMatrix4(mesh.matrixWorld);
}
