// The level registry: every zoom level is a record here, not a piece of engine code.
// Adding a level above the cell later (tissue, organ, body) means adding a record and a scene,
// and changing `ROOT` – the engine does not need to know what a level is about.

export type LevelId = 'cell' | 'mitochondrion' | 'atp-synthase' | 'catalytic-site';

export type SceneKind = 'cell' | 'mitochondrion' | 'atp-synthase' | 'catalytic-site';

export interface Level {
  id: LevelId;
  parent: LevelId | null;
  /** Characteristic size of the thing shown at this level, in metres. */
  sizeMeters: number;
  /** How many metres one world unit stands for in this level's scene. */
  metersPerUnit: number;
  /** Camera distance (world units) when the level is at rest. */
  homeDistance: number;
  scene: SceneKind;
  /** Key into the language file for this level's texts. */
  textKey: string;
}

export const ROOT: LevelId = 'cell';

export const LEVELS: Record<LevelId, Level> = {
  cell: {
    id: 'cell', parent: null, sizeMeters: 12e-6, metersPerUnit: 1e-6, homeDistance: 19,
    scene: 'cell', textKey: 'cell',
  },
  mitochondrion: {
    id: 'mitochondrion', parent: 'cell', sizeMeters: 2e-6, metersPerUnit: 1e-7, homeDistance: 30,
    scene: 'mitochondrion', textKey: 'mitochondrion',
  },
  'atp-synthase': {
    id: 'atp-synthase', parent: 'mitochondrion', sizeMeters: 25e-9, metersPerUnit: 1e-10, homeDistance: 420,
    scene: 'atp-synthase', textKey: 'atpSynthase',
  },
  'catalytic-site': {
    id: 'catalytic-site', parent: 'atp-synthase', sizeMeters: 1.5e-9, metersPerUnit: 1e-10, homeDistance: 34,
    scene: 'catalytic-site', textKey: 'catalyticSite',
  },
};

/** Ids from the root down to `id`, e.g. ['cell', 'mitochondrion']. */
export function pathTo(id: LevelId): LevelId[] {
  const path: LevelId[] = [];
  let cur: LevelId | null = id;
  while (cur) {
    path.unshift(cur);
    cur = LEVELS[cur].parent;
  }
  return path;
}

/**
 * Parameters of the virtual person / virtual cell. They are parameters on purpose: later they can be
 * set from a person's data or switched between hypotheses. Values marked `verified: false` are
 * illustrative and listed as such in the interface.
 */
export const CELL_PARAMS = {
  /** Insulin granules drawn. The literature estimate is ~10,000 per human beta cell; fewer are drawn for clarity. */
  granulesDrawn: 700,
  granulesReal: 10000,
  /** Mitochondria drawn; illustrative, not a measured count. */
  mitochondriaDrawn: 70,
};
