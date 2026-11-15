import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeAnchor } from '../engine/anchors';
import { getData } from '../engine/data';
import type { SceneProps } from './types';
import { fixTransparency } from './util';

const SITE_COLOR = new THREE.Color('#f4f7ff');
const SITE_HOVER = new THREE.Color('#7dffb0');

/**
 * A stand-in for one ATP synthase at its true size, in angstrom, measured from PDB 8H9S:
 * membrane part about 9 nm across around the c-ring, a central stalk, and the F1 head about 10 nm
 * across whose centre is about 13.5 nm from the c-ring centre. Origin = c-ring centre, axis = +Y.
 * It is placed with the same matrix as the full atomic model, so the two line up exactly.
 */
function proxyGeometry(): THREE.BufferGeometry {
  const base = new THREE.CylinderGeometry(45, 45, 40, 20);
  const stalk = new THREE.CylinderGeometry(12, 12, 70, 8).translate(0, 55, 0);
  const head = new THREE.SphereGeometry(50, 16, 12).translate(0, 135, 0);
  return mergeGeometries([base, stalk, head].map((x) => x.toNonIndexed()));
}

export function MitochondrionScene({ role, hidden, hover }: SceneProps) {
  const { mito, mitoSites } = getData();
  const model = useMemo(() => {
    const s = mito.clone(true);
    fixTransparency(s);
    return s;
  }, [mito]);
  const geometry = useMemo(proxyGeometry, []);
  const anchors = useMemo(() => mitoSites.map((_, i) => makeAnchor('mitochondrion', i, new THREE.Vector3())), [mitoSites]);

  const ref = useRef<THREE.InstancedMesh>(null);
  const markerRef = useRef<THREE.Points>(null);

  // The proxies are only a few pixels across at this level's resting view, so each also gets a
  // fixed-size dot. The dot marks where an enzyme is; it says nothing about its size.
  const markerGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(anchors.flatMap((a) => {
      const head = new THREE.Vector3(0, 135, 0).applyMatrix4(a.matrix);
      return [head.x, head.y, head.z];
    }), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(anchors.length * 3).fill(1), 3));
    return g;
  }, [anchors]);

  useLayoutEffect(() => {
    const mesh = ref.current!;
    const gone = new THREE.Matrix4().makeScale(0, 0, 0);
    anchors.forEach((a, i) => mesh.setMatrixAt(i, i === hidden ? gone : a.matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [anchors, hidden]);

  useLayoutEffect(() => {
    const mesh = ref.current!;
    const colors = markerGeometry.getAttribute('color') as THREE.BufferAttribute;
    anchors.forEach((_, i) => {
      const c = role === 'current' && i === hover ? SITE_HOVER : SITE_COLOR;
      mesh.setColorAt(i, c);
      if (i === hidden) colors.setXYZ(i, 0, 0, 0);
      else colors.setXYZ(i, c.r, c.g, c.b);
    });
    mesh.instanceColor!.needsUpdate = true;
    colors.needsUpdate = true;
  }, [anchors, hover, role, hidden, markerGeometry]);

  return (
    <group>
      <primitive object={model} />
      <instancedMesh ref={ref} args={[geometry, undefined, anchors.length]} userData={{ anchorLevel: 'mitochondrion' }}>
        <meshStandardMaterial emissive="#ffffff" emissiveIntensity={0.25} roughness={0.4} />
      </instancedMesh>
      {role !== 'parent' && (
        <points ref={markerRef} geometry={markerGeometry} raycast={() => null} renderOrder={5}>
          <pointsMaterial size={6} sizeAttenuation={false} vertexColors transparent opacity={0.9} depthWrite={false} blending={THREE.AdditiveBlending} />
        </points>
      )}
    </group>
  );
}
