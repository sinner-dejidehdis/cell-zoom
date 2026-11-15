import { useGLTF } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { SceneProps } from './types';
import { asset, fixTransparency, instanceWorldPosition } from './util';

interface Site {
  crista: number;
  position: [number, number, number];
  normal: [number, number, number];
}

const SITE_COLOR = new THREE.Color('#f4f7ff');
const SITE_HOVER = new THREE.Color('#7dffb0');

export function MitochondrionScene({ onZoom }: SceneProps) {
  const gltf = useGLTF(asset('models/mitochondrion.glb'));
  const model = useMemo(() => {
    const s = gltf.scene.clone(true);
    fixTransparency(s);
    return s;
  }, [gltf]);

  const [sites, setSites] = useState<Site[]>([]);
  useEffect(() => {
    fetch(asset('models/mitochondrion-sites.json'))
      .then((r) => r.json())
      .then((d: { sites: Site[] }) => setSites(d.sites));
  }, []);

  const ref = useRef<THREE.InstancedMesh>(null);
  const hovered = useRef(-1);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh || sites.length === 0) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    sites.forEach((s, i) => {
      // The F1 head points into the matrix, away from the crista membrane.
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...s.normal));
      m.compose(new THREE.Vector3(...s.position), q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, SITE_COLOR);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
  }, [sites]);

  const setHover = (id: number) => {
    const mesh = ref.current!;
    if (hovered.current >= 0) mesh.setColorAt(hovered.current, SITE_COLOR);
    if (id >= 0) mesh.setColorAt(id, SITE_HOVER);
    hovered.current = id;
    mesh.instanceColor!.needsUpdate = true;
    document.body.style.cursor = id >= 0 ? 'pointer' : '';
  };

  return (
    <group>
      <primitive object={model} />
      {sites.length > 0 && (
        <instancedMesh
          key={sites.length}
          ref={ref}
          args={[undefined, undefined, sites.length]}
          onPointerMove={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            if (e.instanceId !== undefined && e.instanceId !== hovered.current) setHover(e.instanceId);
          }}
          onPointerOut={() => setHover(-1)}
          onClick={(e: ThreeEvent<MouseEvent>) => {
            e.stopPropagation();
            if (e.instanceId === undefined) return;
            setHover(-1);
            onZoom('atp-synthase', instanceWorldPosition(ref.current!, e.instanceId));
          }}
        >
          {/* A marker roughly the size of the F1 head (drawn ~1.5x larger so it can be clicked). */}
          <sphereGeometry args={[0.09, 12, 8]} />
          <meshStandardMaterial emissive="#ffffff" emissiveIntensity={0.25} roughness={0.4} />
        </instancedMesh>
      )}
    </group>
  );
}

useGLTF.preload(asset('models/mitochondrion.glb'));
