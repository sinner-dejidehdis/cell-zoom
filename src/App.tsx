import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useRef, type ComponentType } from 'react';
import type * as THREE from 'three';
import { LEVELS, pathTo, type LevelId, type SceneKind } from './content/levels';
import { CameraRig, type Entry, type RigApi } from './engine/CameraRig';
import { InfoPanel } from './engine/InfoPanel';
import { hrefFor, navigate, useLevel } from './engine/route';
import { ScaleProbe } from './engine/ScaleProbe';
import { domRefs, setSim, useSim } from './engine/store';
import { levelText, ui } from './i18n';
import { AtpSynthaseScene } from './scenes/AtpSynthaseScene';
import { CatalyticSiteScene } from './scenes/CatalyticSiteScene';
import { CellScene } from './scenes/CellScene';
import { MitochondrionScene } from './scenes/MitochondrionScene';
import type { SceneProps } from './scenes/types';

const SCENES: Record<SceneKind, ComponentType<SceneProps>> = {
  cell: CellScene,
  mitochondrion: MitochondrionScene,
  'atp-synthase': AtpSynthaseScene,
  'catalytic-site': CatalyticSiteScene,
};

function entryFor(prev: LevelId | null, next: LevelId): Entry {
  if (!prev || prev === next) return 'direct';
  if (LEVELS[next].parent === prev) return 'from-parent';
  if (pathTo(prev).includes(next)) return 'from-child';
  return 'direct';
}

export default function App() {
  const level = useLevel();
  const def = LEVELS[level];
  const prevLevel = useRef<LevelId | null>(null);
  const entry = useRef<Entry>('direct');
  if (prevLevel.current !== level) {
    entry.current = entryFor(prevLevel.current, level);
    prevLevel.current = level;
  }
  const rig = useRef<RigApi | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    busy.current = false;
    document.body.style.cursor = '';
  }, [level]);

  const goTo = useCallback((target: LevelId) => {
    if (busy.current || target === level) return;
    busy.current = true;
    if (rig.current) rig.current.flyOut(() => navigate(target));
    else navigate(target);
  }, [level]);

  const onZoom = useCallback((child: LevelId, point: THREE.Vector3) => {
    if (busy.current) return;
    busy.current = true;
    if (rig.current) rig.current.flyInto(point, () => navigate(child));
    else navigate(child);
  }, []);

  const Scene = SCENES[def.scene];
  const text = levelText(def.textKey);
  const crumbs = pathTo(level);
  const sim = useSim();

  return (
    <div className="app">
      <div className="stage">
      <Canvas camera={{ fov: 40 }} dpr={[1, 2]}>
        <color attach="background" args={['#0d1420']} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[5, 8, 6]} intensity={1.6} />
        <directionalLight position={[-6, -3, -4]} intensity={0.45} color="#9ec5ff" />
        <OrbitControls
          key={level}
          makeDefault
          enablePan={false}
          minDistance={def.homeDistance * 0.25}
          maxDistance={def.homeDistance * 2.5}
        />
        <Suspense fallback={null}>
          <group key={level}>
            <Scene onZoom={onZoom} />
            <CameraRig homeDistance={def.homeDistance} entry={entry.current} apiRef={rig} />
            <ScaleProbe metersPerUnit={def.metersPerUnit} />
          </group>
        </Suspense>
      </Canvas>
      </div>

      <div className="fade" ref={(el) => { domRefs.overlay = el; }} />

      <header className="top">
        <div className="brand">
          <strong>{ui.title}</strong>
          <span>{ui.subtitle}</span>
        </div>
        <nav className="crumbs" aria-label="层级">
          {crumbs.map((id, i) => {
            const name = levelText(LEVELS[id].textKey).name;
            return (
              <span key={id}>
                {i > 0 && <span className="sep">/</span>}
                {id === level ? (
                  <span className="current">{name}</span>
                ) : (
                  <a href={hrefFor(id)} onClick={(e) => { e.preventDefault(); goTo(id); }}>
                    {name}
                  </a>
                )}
              </span>
            );
          })}
        </nav>
      </header>

      <div className="hint">
        {def.parent && (
          <button className="back" onClick={() => goTo(def.parent!)}>
            ← {ui.back}
          </button>
        )}
        <span>{text.hint}</span>
        {level === 'atp-synthase' && (
          <span className="sim-controls">
            <button onClick={() => setSim({ playing: !sim.playing })}>{sim.playing ? '暂停旋转' : '继续旋转'}</button>
            <label>
              <input
                type="checkbox"
                checked={sim.showInhibitor}
                onChange={(e) => setSim({ showInhibitor: e.target.checked })}
              />
              显示抑制蛋白 IF1
            </label>
          </span>
        )}
      </div>

      <div className="scale">
        <div className="scale-bar" ref={(el) => { domRefs.scaleBar = el; }} />
        <span ref={(el) => { domRefs.scaleLabel = el; }} />
      </div>

      <InfoPanel key={level} level={level} />
      <div className="badge">{ui.prototype}</div>
    </div>
  );
}
