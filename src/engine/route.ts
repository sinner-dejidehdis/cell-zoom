// Each level has its own hash: #mitochondrion, #atp-synthase. Plain names (no slashes) also work
// inside sandboxed hosts that only pass a simple #name through. Old #/cell/mitochondrion links still parse.
import { LEVELS, ROOT, type LevelId } from '../content/levels';

export function parseHash(hash: string): LevelId {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const last = parts.at(-1);
  if (last && last in LEVELS) return last as LevelId;
  return ROOT;
}

export function hrefFor(id: LevelId): string {
  return '#' + id;
}

/** Record the level in the address without adding a history entry for every zoom step. */
export function replaceHash(id: LevelId): void {
  if (window.location.hash !== hrefFor(id)) history.replaceState(null, '', hrefFor(id));
}
