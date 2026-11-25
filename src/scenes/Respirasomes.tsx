// Respiratory supercomplexes (complex I + III2 + IV, PDB 5XTH) on the flat faces of the cristae.
// Each copy is the low-resolution surface computed from the 5XTH atoms (tools/pdb/build_respirasome.py),
// at true size and with its true orientation in the membrane: the matrix arm of complex I points into the
// matrix, the cytochrome c1 and Rieske heads of complex III into the crista lumen.
// Electron-tomography work places complex I in the flat membrane regions beside the ATP synthase dimer rows
// (Davies et al. 2011); their number is set from that paper's complex I : ATP synthase ratio (see SPACING).
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ATP_IN_MITO } from '../engine/anchors';
import { getData } from '../engine/data';
import { contextDetail } from '../engine/pocket';

// Crista geometry, copied from tools/blender/build_mitochondrion.py (1 unit = 50 nm). Keep the two in sync.
const NM = 1 / 50;
const MEMBRANE = 7 * NM;
const CRISTA_T = ((25 + 2 * 7) * NM) / 2;
const IBM_RADIUS = 4.0 - 13 * NM;
const WALL_GAP = 15 * NM;
const CRISTA_XS = [-8.4, -6.3, -4.2, -2.1, 0.0, 2.1, 4.2, 6.3, 8.4];
const CRISTA_AXES = [3.0, 2.5];
const CRISTA_OFFSET = 1.0;

/** Footprint radius of one supercomplex in the membrane plane (about 18 nm), in units. */
const FOOTPRINT = 18 * NM;
/** Keep this far inside the rim centre line, clear of the ATP synthase dimer rows on the rim. */
const RIM_MARGIN = 27 * NM;
/** Minimum centre-to-centre spacing. Chosen so that about one supercomplex is drawn per 3.4 ATP synthase
 * monomers, close to the 1 complex I : 3.6 ATP synthase counted in one crista of the fungus Podospora
 * anserina (Davies et al. 2011). No spacing for human cells was found. */
const SPACING = 58 * NM;

export const COMPLEX_COLOR: Record<'I' | 'III' | 'IV', string> = { I: '#5b8def', III: '#49b6a6', IV: '#b57edc' };

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Placement {
  matrix: THREE.Matrix4;
  crista: number;
}

/**
 * Places supercomplexes on both flat faces of every crista, on the half kept by the cut-away
 * (Blender y >= 0, which is glTF z <= 0). Positions are in the mitochondrion model's glTF frame.
 * `obstacles` are matrix contents (centre, radius) that a complex must not run into.
 */
export function placeRespirasomes(obstacles: { c: THREE.Vector3; r: number }[]): Placement[] {
  const rand = mulberry32(5);
  const out: Placement[] = [];
  const innerR = IBM_RADIUS - MEMBRANE / 2;
  const [ay, az] = CRISTA_AXES;
  const cy = ay - CRISTA_T - RIM_MARGIN;
  const cz = az - CRISTA_T - RIM_MARGIN;
  const Y = new THREE.Vector3(0, 1, 0);
  CRISTA_XS.forEach((xc, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    const zc = -side * CRISTA_OFFSET;
    for (const face of [-1, 1]) {
      const normal = new THREE.Vector3(face, 0, 0); // towards the matrix
      const x = xc + face * (CRISTA_T - MEMBRANE / 2); // membrane mid-plane
      const placed: THREE.Vector2[] = [];
      for (let k = 0; k < 600; k++) {
        const yb = rand() * cy;
        const zb = zc + (rand() * 2 - 1) * cz;
        if (yb < FOOTPRINT + 2 * NM) continue; // stay whole on the kept half
        if ((yb / cy) ** 2 + ((zb - zc) / cz) ** 2 > 1) continue;
        if (Math.hypot(yb, zb) > innerR - WALL_GAP - FOOTPRINT) continue;
        const p2 = new THREE.Vector2(yb, zb);
        if (placed.some((q) => q.distanceTo(p2) < SPACING)) continue;
        // glTF (x, z_b, -y_b)
        const pos = new THREE.Vector3(x, zb, -yb);
        const probe = pos.clone().addScaledVector(normal, 8 * NM);
        if (obstacles.some((o) => o.c.distanceTo(probe) < o.r + FOOTPRINT)) continue;
        placed.push(p2);
        const q = new THREE.Quaternion().setFromUnitVectors(Y, normal)
          .multiply(new THREE.Quaternion().setFromAxisAngle(Y, rand() * Math.PI * 2));
        out.push({ matrix: new THREE.Matrix4().compose(pos, q, new THREE.Vector3().setScalar(ATP_IN_MITO)), crista: i });
      }
    }
  });
  return out;
}

export function Respirasomes({ placements, isParent }: { placements: Placement[]; isParent: boolean }) {
  const { respirasome } = getData();
  const group = useRef<THREE.Group>(null);
  // Like the ATP synthases: when this level is only the backdrop of a deeper one, show them only if asked.
  useFrame(() => {
    if (group.current) group.current.visible = !isParent || contextDetail.showNeighbours;
  });
  const meshes = useMemo(() => respirasome.parts.map((p) => {
    const mesh = new THREE.InstancedMesh(
      p.geometry,
      new THREE.MeshStandardMaterial({ color: COMPLEX_COLOR[p.complex], roughness: 0.55, metalness: 0.05 }),
      placements.length,
    );
    placements.forEach((pl, i) => mesh.setMatrixAt(i, pl.matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = `Complex${p.complex}`;
    return mesh;
  }), [respirasome, placements]);
  return (
    <group ref={group}>
      {meshes.map((m) => <primitive key={m.name} object={m} />)}
    </group>
  );
}
