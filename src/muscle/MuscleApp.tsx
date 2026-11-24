import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { TextPanel } from '../engine/InfoPanel';
import { levelText, ui } from '../i18n';
import { MusclePanel } from './MusclePanel';
import { MuscleScene } from './MuscleScene';
import { MolecularLevel } from './molecular';
import { CameraRig } from './CameraRig';
import { WheelZoom } from '../engine/WheelZoom';
import { inWedge } from './fiber';
import { getMuscleView, type MuscleLevel } from './store';
import * as THREE from 'three';
import { setMuscleView, useMuscleView } from './store';

/** Ignore hits on parts inside the opened wedge, which are not drawn. */
function acceptHit(h: THREE.Intersection): boolean {
  if (!getMuscleView().cut) return true;
  let g: THREE.Object3D | null = h.object;
  while (g && g.name !== 'fiber') g = g.parent;
  if (!g) return true;
  const p = g.worldToLocal(h.point.clone());
  return !inWedge(p.y, p.z);
}

const LEVELS: Record<MuscleLevel, { name: string; legend: [string, string][]; note: string }> = {
  fiber: { name: '肌纤维', legend: [], note: '一个肌细胞，长约 62 µm 的一段' },
  myofibril: { name: '肌原纤维与肌丝', legend: [['#c0392b', '粗肌丝'], ['#7fc8a9', '细肌丝'], ['#3b6fd8', 'T 管'], ['#9fd3e6', '肌质网终池']], note: '看着哪根肌原纤维，哪根就画出单根肌丝' },
  molecule: { name: '分子', legend: [['#7fc8a9', '肌动蛋白'], ['#e7c35a', '原肌球蛋白'], ['#9b7fe0', '肌钙蛋白'], ['#c8553d', '肌球蛋白头'], ['#ffd24a', '已结合的横桥']], note: '形状来自冷冻电镜结构 8EFI、6KN8' },
  atom: { name: '原子', legend: [['#7fc8a9', '肌动蛋白'], ['#c8553d', '肌球蛋白（人 MYH7）'], ['#e7c35a', '原肌球蛋白'], ['#ff5fd2', '结合的小分子']], note: 'PDB 8EFI，强直（无 ATP）状态，23,256 个非氢原子' },
};

function LevelBadge({ level }: { level: MuscleLevel }) {
  const L = LEVELS[level];
  return (
    <div className="level-badge" aria-live="polite">
      <strong>当前层级：{L.name}</strong>
      <span>{L.note}</span>
      {L.legend.length > 0 && (
        <span className="legend">{L.legend.map(([c, t]) => <span key={t}><i style={{ background: c }} />{t}</span>)}</span>
      )}
    </div>
  );
}

export function MuscleApp({ tabs }: { tabs: React.ReactNode }) {
  const view = useMuscleView();
  const t = levelText('muscle');
  return (
    <div className="app">
      <div className="stage">
        <Canvas camera={{ fov: 40, position: [30, 62, 98], near: 0.00001, far: 2000 }} dpr={[1, 2]} gl={{ logarithmicDepthBuffer: true, antialias: true }}>
          <color attach="background" args={['#0d1420']} />
          <ambientLight intensity={0.55} />
          <directionalLight position={[5, 8, 6]} intensity={1.6} />
          <directionalLight position={[-6, -3, -4]} intensity={0.45} color="#9ec5ff" />
          <MuscleScene />
          <MolecularLevel />
          <CameraRig />
          <OrbitControls makeDefault enableZoom={false} target={[0, 0, 0]} />
          <WheelZoom minDistance={0.0003} maxDistance={400} accept={acceptHit} />
        </Canvas>
      </div>
      <header className="top">
        <div className="brand">
          <strong>{ui.title}</strong>
          <span>{t.name}</span>
        </div>
      </header>
      {tabs}
      <div className="hint">
        <span>{t.hint}</span>
        <span className="sim-controls">
          <button onClick={() => setMuscleView({ preset: 'overview' })}>全貌</button>
          <button onClick={() => setMuscleView({ preset: 'myofibrils' })}>看肌原纤维</button>
          <button onClick={() => setMuscleView({ preset: 'filaments' })}>看肌丝</button>
          <button onClick={() => setMuscleView({ preset: 'molecules' })}>看分子</button>
          <button onClick={() => setMuscleView({ preset: 'atoms' })}>看原子</button>
          <label>
            <input type="checkbox" checked={view.cut} onChange={(e) => setMuscleView({ cut: e.target.checked })} />
            剖开肌纤维
          </label>
          <label>
            <input type="checkbox" checked={view.isometric} onChange={(e) => setMuscleView({ isometric: e.target.checked })} />
            两端固定（等长收缩）
          </label>
        </span>
      </div>
      <LevelBadge level={view.level} />
      <MusclePanel />
      <TextPanel t={t} open={view.panelOpen} setOpen={(v) => setMuscleView({ panelOpen: v })} />
      <div className="badge">{ui.prototype}</div>
    </div>
  );
}
