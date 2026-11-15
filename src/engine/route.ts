// Each level has its own hash: #mitochondrion, #atp-synthase. Plain names (no slashes) also work
// inside sandboxed hosts that only pass a simple #name through. Old #/cell/mitochondrion links still parse.
import { useEffect, useState } from 'react';
import { LEVELS, ROOT, type LevelId } from '../content/levels';

function parse(hash: string): LevelId {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const last = parts.at(-1);
  if (last && last in LEVELS) return last as LevelId;
  return ROOT;
}

export function hrefFor(id: LevelId): string {
  return '#' + id;
}

export function navigate(id: LevelId): void {
  window.location.hash = hrefFor(id);
}

export function useLevel(): LevelId {
  const [level, setLevel] = useState<LevelId>(() => parse(window.location.hash));
  useEffect(() => {
    const onHash = () => setLevel(parse(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return level;
}
