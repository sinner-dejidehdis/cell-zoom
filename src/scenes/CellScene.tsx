import { useGLTF } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CELL_PARAMS } from '../content/levels';
import type { SceneProps } from './types';
import { asset, fixTransparency, instanceWorldPosition, randomInBall, randomQuat, rng } from './util';

// Positions of the Blender-built parts, in this scene's frame (1 unit = 1 um, Y up).
const NUCLEUS = new THREE.Vector3(-1.3, 0.2, -0.4);
const NUCLEUS_CLEAR = 3.0;
const GOLGI = new THREE.Vector3(2.1, 0.9, -1.4);
const CYTOPLASM_RADIUS = 4.6;

const MITO_COLOR = new THREE.Color('#f08a4b');
const MITO_HOVER = new THREE.Color('#ffe08a');

function scatter(seed: number, count: number, minGap: number) {
  const r = rng(seed);
  const out: { p: THREE.Vector3; q: THREE.Quaternion }[] = [];
  while (out.length < count) {
    const p = randomInBall(r, CYTOPLASM_RADIUS);
    if (p.distanceTo(NUCLEUS) < NUCLEUS_CLEAR + minGap) continue;
    if (p.distanceTo(GOLGI) < 1.2 + minGap) continue;
    out.push({ p, q: randomQuat(r) });
  }
  return out;
}

export function CellScene({ onZoom }: SceneProps) {
  const gltf = useGLTF(asset('models/cell.glb'));
  const model = useMemo(() => {
    const s = gltf.scene.clone(true);
    fixTransparency(s);
    return s;
  }, [gltf]);

  const mitoRef = useRef<THREE.InstancedMesh>(null);
  const granuleRef = useRef<THREE.InstancedMesh>(null);
  const hovered = useRef(-1);

  const mitos = useMemo(() => scatter(7, CELL_PARAMS.mitochondriaDrawn, 0.3), []);
  const granules = useMemo(() => scatter(11, CELL_PARAMS.granulesDrawn, 0.1), []);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    mitos.forEach(({ p, q }, i) => {
      mitoRef.current!.setMatrixAt(i, m.compose(p, q, one));
      mitoRef.current!.setColorAt(i, MITO_COLOR);
    });
    mitoRef.current!.instanceMatrix.needsUpdate = true;
    mitoRef.current!.instanceColor!.needsUpdate = true;
    granules.forEach(({ p, q }, i) => granuleRef.current!.setMatrixAt(i, m.compose(p, q, one)));
    granuleRef.current!.instanceMatrix.needsUpdate = true;
  }, [mitos, granules]);

  const setHover = (id: number) => {
    const mesh = mitoRef.current!;
    if (hovered.current >= 0) mesh.setColorAt(hovered.current, MITO_COLOR);
    if (id >= 0) mesh.setColorAt(id, MITO_HOVER);
    hovered.current = id;
    mesh.instanceColor!.needsUpdate = true;
    document.body.style.cursor = id >= 0 ? 'pointer' : '';
  };

  return (
    <group>
      <primitive object={model} />
      <instancedMesh
        ref={mitoRef}
        args={[undefined, undefined, mitos.length]}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          if (e.instanceId !== undefined && e.instanceId !== hovered.current) setHover(e.instanceId);
        }}
        onPointerOut={() => setHover(-1)}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (e.instanceId === undefined) return;
          setHover(-1);
          onZoom('mitochondrion', instanceWorldPosition(mitoRef.current!, e.instanceId));
        }}
      >
        <capsuleGeometry args={[0.26, 1.1, 6, 12]} />
        <meshStandardMaterial roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={granuleRef} args={[undefined, undefined, granules.length]} raycast={() => null}>
        <icosahedronGeometry args={[0.13, 1]} />
        <meshStandardMaterial color="#f4ecd8" roughness={0.4} />
      </instancedMesh>
    </group>
  );
}

useGLTF.preload(asset('models/cell.glb'));
