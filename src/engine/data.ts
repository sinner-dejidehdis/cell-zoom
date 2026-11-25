// Everything the levels need is loaded once, up front, so that zooming never waits on the network.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { asset } from '../scenes/util';

export interface MitoSite {
  crista: number;
  position: [number, number, number];
  normal: [number, number, number];
}

export interface AtpMeta {
  pdbId: string;
  atomCount: number;
  elements: string[];
  chains: { id: string; subunit: string }[];
  groups: Record<'stator' | 'rotor' | 'inhibitor' | 'ligand', number>;
  site: { chain: string; position: [number, number, number] };
  axis: { origin: [number, number, number]; direction: [number, number, number] };
}

export interface Structure {
  meta: AtpMeta;
  pos: Float32Array;
  element: Uint8Array;
  chain: Uint8Array;
  group: Uint8Array;
  /** Rotation that stands the enzyme up: rotation axis -> +Y. */
  align: THREE.Quaternion;
  /** c-ring centre (on the rotation axis, in the membrane), in the file's coordinates. */
  axisOrigin: THREE.Vector3;
  axisDir: THREE.Vector3;
}

export interface SiteAtom {
  el: string;
  name: string;
  resn: string;
  resi: string;
  chain: string;
  ligand: boolean;
  xyz: [number, number, number];
}

export interface SiteData {
  pdbId: string;
  atoms: SiteAtom[];
  bonds: [number, number][];
}

export interface Cofactor {
  chain: string;
  type: string;
  complex: 'I' | 'III' | 'IV';
  xyz: [number, number, number];
}

/** Respiratory supercomplex I + III2 + IV (PDB 5XTH): one low-resolution surface per complex, in angstrom,
 * y = membrane normal towards the matrix, origin on the membrane mid-plane. */
export interface Respirasome {
  parts: { complex: 'I' | 'III' | 'IV'; geometry: THREE.BufferGeometry }[];
  cofactors: Cofactor[];
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

interface RespirasomeMeta {
  parts: { complex: 'I' | 'III' | 'IV'; vertexOffset: number; vertexCount: number; indexOffset: number; indexCount: number }[];
  cofactors: Cofactor[];
  bounds: Respirasome['bounds'];
}

async function loadRespirasome(): Promise<Respirasome> {
  const [meta, bin] = await Promise.all([
    fetch(asset('data/respirasome.json')).then((r) => r.json() as Promise<RespirasomeMeta>),
    fetch(asset('data/respirasome.bin')).then((r) => r.arrayBuffer()),
  ]);
  const parts = meta.parts.map((p) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin, p.vertexOffset, p.vertexCount * 3), 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(bin, p.indexOffset, p.indexCount), 1));
    g.computeVertexNormals();
    return { complex: p.complex, geometry: g };
  });
  return { parts, cofactors: meta.cofactors, bounds: meta.bounds };
}

export interface Data {
  cell: THREE.Group;
  /** Low-detail mitochondrion for the cell level: outer membrane, and inner membrane with cristae. */
  mitoLod: { outer: THREE.BufferGeometry; inner: THREE.BufferGeometry };
  mito: THREE.Group;
  mitoSites: MitoSite[];
  atp: Structure;
  site: SiteData;
  respirasome: Respirasome;
}

let data: Data | null = null;

export function getData(): Data {
  if (!data) throw new Error('data not loaded');
  return data;
}

async function loadGltf(path: string): Promise<THREE.Group> {
  const gltf = await new GLTFLoader().loadAsync(asset(path));
  return gltf.scene;
}

async function loadAtp(): Promise<Structure> {
  const [meta, bin] = await Promise.all([
    fetch(asset('data/atp-synthase.json')).then((r) => r.json() as Promise<AtpMeta>),
    fetch(asset('data/atp-synthase.bin')).then((r) => r.arrayBuffer()),
  ]);
  const n = meta.atomCount;
  const axisDir = new THREE.Vector3(...meta.axis.direction).normalize();
  return {
    meta,
    pos: new Float32Array(bin, 0, n * 3),
    element: new Uint8Array(bin, n * 12, n),
    chain: new Uint8Array(bin, n * 13, n),
    group: new Uint8Array(bin, n * 14, n),
    align: new THREE.Quaternion().setFromUnitVectors(axisDir, new THREE.Vector3(0, 1, 0)),
    axisOrigin: new THREE.Vector3(...meta.axis.origin),
    axisDir,
  };
}

export async function loadAll(onProgress: (done: number, total: number) => void): Promise<Data> {
  let done = 0;
  const total = 7;
  const tick = <T,>(p: Promise<T>) => p.then((v) => (onProgress(++done, total), v));
  const [cell, mito, sites, atp, site, lod, respirasome] = await Promise.all([
    tick(loadGltf('models/cell.glb')),
    tick(loadGltf('models/mitochondrion.glb')),
    tick(fetch(asset('models/mitochondrion-sites.json')).then((r) => r.json() as Promise<{ sites: MitoSite[] }>)),
    tick(loadAtp()),
    tick(fetch(asset('data/atp-synthase-site.json')).then((r) => r.json() as Promise<SiteData>)),
    tick(loadGltf('models/mitochondrion-lod.glb')),
    tick(loadRespirasome()),
  ]);
  const geometryOf = (name: string) => {
    const m = lod.getObjectByName(name) as THREE.Mesh | undefined;
    if (!m) throw new Error(`mitochondrion-lod.glb has no ${name}`);
    return m.geometry;
  };
  data = { cell, mito, mitoSites: sites.sites, atp, site, respirasome, mitoLod: { outer: geometryOf('Outer'), inner: geometryOf('Inner') } };
  return data;
}
