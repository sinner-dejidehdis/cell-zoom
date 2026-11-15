import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CELL_PARAMS } from '../content/levels';
import { CELL_LAYOUT, MITO_CAPSULE } from '../engine/anchors';
import { getData } from '../engine/data';
import { nearClip, withCutaway, withPocket } from '../engine/pocket';
import { useSim } from '../engine/store';
import type { SceneProps } from './types';
import { fixTransparency } from './util';

const MITO_COLOR = new THREE.Color('#f08a4b');
const MITO_HOVER = new THREE.Color('#ffe08a');
const ZERO = new THREE.Vector3(0, 0, 0);

/** Ray casting that ignores instances hidden by the clip sphere around the camera. */
function clippedRaycast(this: THREE.InstancedMesh, raycaster: THREE.Raycaster, hits: THREE.Intersection[]) {
  const mine: THREE.Intersection[] = [];
  THREE.InstancedMesh.prototype.raycast.call(this, raycaster, mine);
  const m = new THREE.Matrix4();
  const c = new THREE.Vector3();
  for (const h of mine) {
    this.getMatrixAt(h.instanceId!, m);
    c.setFromMatrixPosition(m).applyMatrix4(this.matrixWorld);
    if (c.distanceTo(nearClip.uClipCenter.value) >= nearClip.uClipRadius.value) hits.push(h);
  }
}

function noRaycast() {}

export function CellScene({ role, hidden, hover }: SceneProps) {
  const model = useMemo(() => {
    const s = getData().cell.clone(true);
    fixTransparency(s);
    // Organelles are cut away near the camera, like the granules, so a flight through them stays readable.
    s.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = withCutaway((mesh.material as THREE.Material).clone());
      mesh.raycast = function (raycaster, hits) {
        const mine: THREE.Intersection[] = [];
        THREE.Mesh.prototype.raycast.call(this, raycaster, mine);
        for (const h of mine) if (h.point.distanceTo(nearClip.uClipCenter.value) >= nearClip.uClipRadius.value) hits.push(h);
      };
    });
    return s;
  }, []);

  const sparse = useSim().sparseGranules;
  const granuleCount = sparse ? Math.floor(CELL_LAYOUT.granules.length / 10) : CELL_LAYOUT.granules.length;
  const mitoMaterial = useMemo(() => withPocket(new THREE.MeshStandardMaterial({ roughness: 0.5 }), nearClip), []);
  // A granule is a crystalline insulin core (faceted) inside its limiting membrane (translucent shell).
  const coreMaterial = useMemo(() => withPocket(new THREE.MeshStandardMaterial({ color: '#e9cf92', roughness: 0.45 }), nearClip), []);
  const shellMaterial = useMemo(
    () => withPocket(new THREE.MeshStandardMaterial({ color: '#f7f1e3', roughness: 0.3, transparent: true, opacity: 0.4, depthWrite: false }), nearClip),
    [],
  );
  const mitoRef = useRef<THREE.InstancedMesh>(null);
  const granuleRef = useRef<THREE.InstancedMesh>(null);
  const shellRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    CELL_LAYOUT.mitos.forEach(({ p, q }, i) => {
      mitoRef.current!.setMatrixAt(i, m.compose(p, q, i === hidden ? ZERO : one));
    });
    mitoRef.current!.instanceMatrix.needsUpdate = true;
    mitoRef.current!.computeBoundingSphere();
  }, [hidden]);

  useLayoutEffect(() => {
    const mesh = mitoRef.current!;
    CELL_LAYOUT.mitos.forEach((_, i) => mesh.setColorAt(i, role === 'current' && i === hover ? MITO_HOVER : MITO_COLOR));
    mesh.instanceColor!.needsUpdate = true;
  }, [hover, role]);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    CELL_LAYOUT.granules.forEach(({ p, q, s }, i) => {
      m.compose(p, q, v.setScalar(s));
      granuleRef.current!.setMatrixAt(i, m);
      shellRef.current!.setMatrixAt(i, m);
    });
    granuleRef.current!.instanceMatrix.needsUpdate = true;
    shellRef.current!.instanceMatrix.needsUpdate = true;
    granuleRef.current!.computeBoundingSphere();
    shellRef.current!.computeBoundingSphere();
  }, []);

  return (
    <group>
      <primitive object={model} />
      <instancedMesh ref={mitoRef} args={[undefined, mitoMaterial, CELL_LAYOUT.mitos.length]} userData={{ anchorLevel: 'cell' }} raycast={clippedRaycast}>
        <capsuleGeometry args={[MITO_CAPSULE.radius, MITO_CAPSULE.length, 6, 16]} />
      </instancedMesh>
      <instancedMesh ref={granuleRef} args={[undefined, coreMaterial, CELL_LAYOUT.granules.length]} count={granuleCount} raycast={clippedRaycast}>
        <icosahedronGeometry args={[CELL_PARAMS.granuleCore / 2, 2]} />
      </instancedMesh>
      <instancedMesh ref={shellRef} args={[undefined, shellMaterial, CELL_LAYOUT.granules.length]} count={granuleCount} raycast={noRaycast}>
        <icosahedronGeometry args={[0.5, 2]} />
      </instancedMesh>
    </group>
  );
}
