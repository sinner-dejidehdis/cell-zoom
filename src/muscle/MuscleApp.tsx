import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { TextPanel } from '../engine/InfoPanel';
import { levelText, ui } from '../i18n';
import { MusclePanel } from './MusclePanel';
import { MuscleScene } from './MuscleScene';
import { setMuscleView, useMuscleView } from './store';

export function MuscleApp({ tabs }: { tabs: React.ReactNode }) {
  const view = useMuscleView();
  const t = levelText('muscle');
  return (
    <div className="app">
      <div className="stage">
        <Canvas camera={{ fov: 40, position: [30, 62, 98], near: 0.002, far: 2000 }} dpr={[1, 2]} gl={{ logarithmicDepthBuffer: true, antialias: true }}>
          <color attach="background" args={['#0d1420']} />
          <ambientLight intensity={0.55} />
          <directionalLight position={[5, 8, 6]} intensity={1.6} />
          <directionalLight position={[-6, -3, -4]} intensity={0.45} color="#9ec5ff" />
          <MuscleScene />
          <OrbitControls makeDefault zoomToCursor minDistance={0.15} maxDistance={400} target={[0, 0, 0]} />
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
      <MusclePanel />
      <TextPanel t={t} open={view.panelOpen} setOpen={(v) => setMuscleView({ panelOpen: v })} />
      <div className="badge">{ui.prototype}</div>
    </div>
  );
}
