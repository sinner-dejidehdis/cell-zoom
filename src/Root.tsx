// Which cell is shown: each cell type is its own page, chosen with the tabs at the top.
import { useEffect, useState } from 'react';
import App from './App';
import { MuscleApp } from './muscle/MuscleApp';

type CellType = 'beta' | 'muscle';
const TYPES: { id: CellType; label: string; hash: string }[] = [
  { id: 'beta', label: 'β 细胞 · 胰岛素分泌', hash: '#cell' },
  { id: 'muscle', label: '骨骼肌纤维 · 收缩', hash: '#muscle' },
];

const typeOf = (hash: string): CellType => (hash.replace('#', '').split('/')[0] === 'muscle' ? 'muscle' : 'beta');

export default function Root() {
  const [type, setType] = useState<CellType>(() => typeOf(window.location.hash));
  useEffect(() => {
    const on = () => setType(typeOf(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const tabs = (
    <nav className="celltypes" aria-label="细胞类型">
      {TYPES.map((t) => (
        <a key={t.id} href={t.hash} className={t.id === type ? 'current' : ''}>{t.label}</a>
      ))}
      <span className="soon" title="正在制作">神经元 · 放电（制作中）</span>
    </nav>
  );
  return type === 'muscle' ? <MuscleApp tabs={tabs} /> : <App tabs={tabs} />;
}
