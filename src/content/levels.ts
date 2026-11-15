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
  /** Point the camera looks at when the level is at rest (own units). */
  viewCenter: [number, number, number];
  /**
   * Zoom thresholds, all camera distances in this level's own units.
   * revealAt: when the camera, measured in this level's units, comes this close, the level is drawn in full
   *   detail inside its parent; enterAt: closer than this, the camera switches into this level's frame;
   * exit: farther than this, the camera switches out to the parent (must exceed enterAt, so the switch
   *   does not flicker back and forth);
   * focusRadius: how close the orbit target must be to one of this level's children to focus it;
   * min: closest allowed distance when no child is in focus; max: farthest allowed distance at the root.
   */
  zoom: { revealAt?: number; enterAt?: number; exit?: number; focusRadius?: number; min: number; max?: number };
}

export const ROOT: LevelId = 'cell';

export const LEVELS: Record<LevelId, Level> = {
  cell: {
    id: 'cell', parent: null, sizeMeters: 13e-6, metersPerUnit: 1e-6, homeDistance: 21,
    scene: 'cell', textKey: 'cell', viewCenter: [0, 0, 0],
    zoom: { focusRadius: 0.6, min: 1.5, max: 45 },
  },
  mitochondrion: {
    id: 'mitochondrion', parent: 'cell', sizeMeters: 1e-6, metersPerUnit: 5e-8, homeDistance: 30,
    scene: 'mitochondrion', textKey: 'mitochondrion', viewCenter: [0, 0, 0],
    zoom: { revealAt: 150, enterAt: 40, exit: 60, focusRadius: 0.4, min: 0.3 },
  },
  'atp-synthase': {
    id: 'atp-synthase', parent: 'mitochondrion', sizeMeters: 25e-9, metersPerUnit: 1e-10, homeDistance: 420,
    scene: 'atp-synthase', textKey: 'atpSynthase', viewCenter: [0, 75, 0],
    zoom: { revealAt: 3000, enterAt: 700, exit: 1400, focusRadius: 25, min: 25 },
  },
  'catalytic-site': {
    id: 'catalytic-site', parent: 'atp-synthase', sizeMeters: 1.5e-9, metersPerUnit: 1e-10, homeDistance: 34,
    scene: 'catalytic-site', textKey: 'catalyticSite', viewCenter: [0, 0, 0],
    zoom: { revealAt: 90, enterAt: 45, exit: 75, min: 6 },
  },
};

export const ORDER: LevelId[] = ['cell', 'mitochondrion', 'atp-synthase', 'catalytic-site'];

/** The level one step down, if this prototype has modelled one. */
export function childOf(id: LevelId): LevelId | null {
  return ORDER.find((c) => LEVELS[c].parent === id) ?? null;
}

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
 * set from a person's data or switched between hypotheses. Each value says where it comes from.
 */
export const CELL_PARAMS = {
  /** Mean human beta-cell volume, um3 (stereology, PubMed 22797400). The model is a sphere of this volume: 13.0 um across. */
  cellVolume: 1158,
  /** Insulin granules per human beta cell (BioNumbers 109971). All are drawn; the interface can thin them out. */
  granules: 10000,
  /** Granule diameter, um: about 300 nm in reviews of human and rodent EM; species and fixation change it by ~20 %. */
  granuleDiameter: 0.3,
  /**
   * Mitochondrial volume density in beta cells of non-diabetic human donors: 3.1 % of cell volume
   * (Diabetologia 2005, doi 10.1007/s00125-004-1627-9). The size of one mitochondrion here (1.0 x 0.4 um,
   * 0.109 um3) is illustrative, so the count follows from the total: 330 x 0.109 um3 = 36 um3 = 3.1 % of 1,158 um3.
   */
  mitochondria: 330,
};
