import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { TextPanel } from '../engine/InfoPanel';
import { levelText, ui } from '../i18n';
import { MusclePanel } from './MusclePanel';
import { MuscleScene } from './MuscleScene';
import { CameraRig } from './CameraRig';
import { WheelZoom } from '../engine/WheelZoom';
import { inWedge } from './fiber';
import { getMuscleView } from './store';
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
          <CameraRig />
          <OrbitControls makeDefault enableZoom={false} target={[0, 0, 0]} />
          <WheelZoom minDistance={0.01} maxDistance={400} accept={acceptHit} />
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
          <button onClick={() => setMuscleView({ preset: 'filaments' })}>看肌丝和横桥</button>
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
