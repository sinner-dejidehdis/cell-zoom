import { Html } from '@react-three/drei';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { SceneProps } from './types';
import { asset } from './util';

interface SiteAtom {
  el: string;
  name: string;
  resn: string;
  resi: string;
  chain: string;
  ligand: boolean;
  xyz: [number, number, number];
}

interface Site {
  pdbId: string;
  atoms: SiteAtom[];
  bonds: [number, number][];
}

// CPK-style element colours; ligand carbons are yellow so ADP stands out from the protein.
const ELEMENT_COLOR: Record<string, string> = {
  C: '#a3a3a3', N: '#4a6cff', O: '#ff3b3b', S: '#ffe14d', P: '#ff9a1f', MG: '#8aff4a',
};
const LIGAND_CARBON = '#f2c94c';

// Labels: residue (chain, number) -> text shown beside its alpha carbon.
const LABELS: { chain: string; resi: string; atom: string; text: string }[] = [
  { chain: 'D', resi: '165', atom: 'NZ', text: 'Lys165（P 环）' },
  { chain: 'D', resi: '166', atom: 'OG1', text: 'Thr166（P 环）' },
  { chain: 'C', resi: '373', atom: 'CZ', text: 'Arg373（α 亚基，链 C）' },
];

function atomColor(a: SiteAtom): string {
  if (a.ligand && a.el === 'C') return LIGAND_CARBON;
  return ELEMENT_COLOR[a.el] ?? '#cccccc';
}

export function CatalyticSiteScene(_: SceneProps) {
  const [site, setSite] = useState<Site | null>(null);
  useEffect(() => {
    fetch(asset('data/atp-synthase-site.json')).then((r) => r.json()).then(setSite);
  }, []);

  const atomsRef = useRef<THREE.InstancedMesh>(null);
  const bondsRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    if (!site || !atomsRef.current || !bondsRef.current) return;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    site.atoms.forEach((a, i) => {
      // Ball-and-stick: balls well below van der Waals size so the bonds stay visible. Mg2+ drawn larger.
      const r = a.el === 'MG' ? 0.7 : a.ligand ? 0.42 : 0.32;
      m.makeScale(r, r, r).setPosition(...a.xyz);
      atomsRef.current!.setMatrixAt(i, m);
      atomsRef.current!.setColorAt(i, c.set(atomColor(a)));
    });
    atomsRef.current.instanceMatrix.needsUpdate = true;
    atomsRef.current.instanceColor!.needsUpdate = true;

    const up = new THREE.Vector3(0, 1, 0);
    site.bonds.forEach(([i, j], k) => {
      const a = new THREE.Vector3(...site.atoms[i].xyz);
      const b = new THREE.Vector3(...site.atoms[j].xyz);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const dir = b.clone().sub(a);
      const q = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
      const isLigand = site.atoms[i].ligand && site.atoms[j].ligand;
      m.compose(mid, q, new THREE.Vector3(isLigand ? 0.16 : 0.12, dir.length(), isLigand ? 0.16 : 0.12));
      bondsRef.current!.setMatrixAt(k, m);
      bondsRef.current!.setColorAt(k, c.set(isLigand ? '#e8c45a' : '#8f8f8f'));
    });
    bondsRef.current.instanceMatrix.needsUpdate = true;
    bondsRef.current.instanceColor!.needsUpdate = true;
  }, [site]);

  const labels = useMemo(() => {
    if (!site) return [];
    const out: { pos: THREE.Vector3; text: string; strong?: boolean }[] = [];
    for (const l of LABELS) {
      const a = site.atoms.find((x) => x.chain === l.chain && x.resi === l.resi && x.name === l.atom);
      if (a) out.push({ pos: new THREE.Vector3(...a.xyz), text: l.text });
    }
    const mg = site.atoms.find((a) => a.el === 'MG');
    if (mg) out.push({ pos: new THREE.Vector3(...mg.xyz), text: 'Mg²⁺', strong: true });
    const pb = site.atoms.find((a) => a.ligand && a.name === 'PB');
    if (pb) out.push({ pos: new THREE.Vector3(...pb.xyz), text: 'ADP（β 磷酸）', strong: true });
    return out;
  }, [site]);

  if (!site) return null;

  return (
    <group>
      <instancedMesh ref={atomsRef} args={[undefined, undefined, site.atoms.length]} raycast={() => null}>
        <sphereGeometry args={[1, 20, 14]} />
        <meshStandardMaterial roughness={0.35} />
      </instancedMesh>
      <instancedMesh ref={bondsRef} args={[undefined, undefined, site.bonds.length]} raycast={() => null}>
        <cylinderGeometry args={[1, 1, 1, 10]} />
        <meshStandardMaterial roughness={0.4} />
      </instancedMesh>
      {labels.map((l) => (
        <Html key={l.text} position={l.pos} center style={{ pointerEvents: 'none' }}>
          <span className={l.strong ? 'atom-label strong' : 'atom-label'}>{l.text}</span>
        </Html>
      ))}
    </group>
  );
}
