// Which cell is shown: each cell type is its own page, chosen with the tabs at the top.
import { useEffect, useState } from 'react';
import App from './App';
import { MuscleApp } from './muscle/MuscleApp';
import { NeuronApp } from './neuron/NeuronApp';

type CellType = 'beta' | 'muscle' | 'neuron';
const TYPES: { id: CellType; label: string; hash: string }[] = [
  { id: 'beta', label: 'β 细胞 · 胰岛素分泌', hash: '#cell' },
  { id: 'muscle', label: '骨骼肌纤维 · 收缩', hash: '#muscle' },
  { id: 'neuron', label: '神经元 · 突触与放电', hash: '#neuron' },
];

const typeOf = (hash: string): CellType => {
  const h = hash.replace('#', '').split('/')[0];
  return h === 'muscle' || h === 'neuron' ? h : 'beta';
};

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
    </nav>
  );
  if (type === 'muscle') return <MuscleApp tabs={tabs} />;
  if (type === 'neuron') return <NeuronApp tabs={tabs} />;
  return <App tabs={tabs} />;
}
