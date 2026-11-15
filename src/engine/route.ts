// Hash routes follow the level tree: #/cell/mitochondrion/atp-synthase
// Hash routing keeps the site working on static hosting such as GitHub Pages.
import { useEffect, useState } from 'react';
import { LEVELS, ROOT, pathTo, type LevelId } from '../content/levels';

function parse(hash: string): LevelId {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const last = parts.at(-1);
  if (last && last in LEVELS) return last as LevelId;
  return ROOT;
}

export function hrefFor(id: LevelId): string {
  return '#/' + pathTo(id).join('/');
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
