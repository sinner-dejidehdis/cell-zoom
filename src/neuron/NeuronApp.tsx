import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { TextPanel } from '../engine/InfoPanel';
import { levelText, ui } from '../i18n';
import { CameraRig, type Presets } from '../muscle/CameraRig';
import { sendNeuron } from '../sim/neuron/client';
import { featuredFrame } from './geometry';
import { NeuronPanel } from './NeuronPanel';
import { NeuronScene } from './NeuronScene';
import { getNeuronView, setNeuronView, useNeuronView, type NeuronPreset } from './store';

const F = featuredFrame();
const side = F.dirW.clone().cross(F.axisW).normalize();
export const NEURON_PRESETS: Presets = {
  overview: { target: new THREE.Vector3(0, 150, 0), pos: new THREE.Vector3(700, 400, 2300) },
  soma: { target: new THREE.Vector3(0, -15, 0), pos: new THREE.Vector3(60, 15, 140) },
  // Target a little to the right of the synapse so it sits left of the text panel.
  synapse: { target: F.centerW.clone().addScaledVector(F.axisW, 0.35), pos: F.centerW.clone().addScaledVector(side, 3.4).addScaledVector(F.dirW, 0.5).addScaledVector(F.axisW, 0.9) },
};

function take(): string | null {
  const p = getNeuronView().preset;
  if (p) setNeuronView({ preset: null });
  return p;
}

function go(p: NeuronPreset) {
  setNeuronView({ preset: p });
  if (p === 'synapse') sendNeuron({ type: 'set', speed: 0.001 });
}

export function NeuronApp({ tabs }: { tabs: React.ReactNode }) {
  const view = useNeuronView();
  const t = levelText('neuron');
  const o = NEURON_PRESETS.overview;
  return (
    <div className="app">
      <div className="stage">
        <Canvas camera={{ fov: 40, position: o.pos.toArray(), near: 0.005, far: 20000 }} dpr={[1, 2]} gl={{ logarithmicDepthBuffer: true, antialias: true }}>
          <color attach="background" args={['#0b111c']} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[5, 8, 6]} intensity={1.5} />
          <directionalLight position={[-6, -3, -4]} intensity={0.45} color="#9ec5ff" />
          <NeuronScene />
          <CameraRig presets={NEURON_PRESETS} take={take} seconds={2} />
          <OrbitControls makeDefault zoomToCursor minDistance={0.05} maxDistance={6000} target={o.target.toArray()} />
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
          <button onClick={() => go('overview')}>全貌</button>
          <button onClick={() => go('soma')}>看胞体和轴突起点</button>
          <button onClick={() => go('synapse')}>看一个突触</button>
        </span>
      </div>
      <NeuronPanel />
      <TextPanel t={t} open={view.panelOpen} setOpen={(v) => setNeuronView({ panelOpen: v })} />
      <div className="badge">{ui.prototype}</div>
    </div>
  );
}
