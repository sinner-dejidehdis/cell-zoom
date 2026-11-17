import { Canvas } from '@react-three/fiber';
import { useEffect, useState } from 'react';
import { LEVELS, ORDER, pathTo, type LevelId } from './content/levels';
import { Controller, flyTo, ladderFraction, view } from './engine/Controller';
import { loadAll } from './engine/data';
import { InfoPanel } from './engine/InfoPanel';
import { hrefFor, parseHash, replaceHash } from './engine/route';
import { domRefs, setSim, useSim } from './engine/store';
import { World } from './engine/World';
import { initWorld, useWorld } from './engine/world';
import { levelText, ui } from './i18n';
import { PhysioPanel } from './sim/PhysioPanel';

export default function App() {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>({ done: 0, total: 1 });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadAll((done, total) => setProgress({ done, total }))
      .then(() => {
        initWorld(parseHash(window.location.hash));
        setProgress(null);
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  if (error) return <div className="loading">加载失败：{error}</div>;
  if (progress) {
    return (
      <div className="loading">
        <span>{ui.loading}</span>
        <div className="loading-bar"><div style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
      </div>
    );
  }
  return <Viewer />;
}

function Viewer() {
  const w = useWorld();
  const level = w.level;
  const def = LEVELS[level];
  const text = levelText(def.textKey);
  const crumbs = pathTo(level);
  const sim = useSim();

  useEffect(() => replaceHash(level), [level]);
  useEffect(() => {
    const onHash = () => flyTo(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const zoomBy = (logFactor: number) => {
    view.pivot.copy(view.target);
    view.autopilot = null;
    view.pendingZoom += logFactor;
  };

  return (
    <div className="app">
      <div className="stage">
        <Canvas camera={{ fov: 40 }} dpr={[1, 2]} gl={{ logarithmicDepthBuffer: true, antialias: true }}>
          <color attach="background" args={['#0d1420']} />
          <ambientLight intensity={0.55} />
          <directionalLight position={[5, 8, 6]} intensity={1.6} />
          <directionalLight position={[-6, -3, -4]} intensity={0.45} color="#9ec5ff" />
          <World />
          <Controller />
        </Canvas>
      </div>

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
                  <a href={hrefFor(id)} onClick={(e) => { e.preventDefault(); flyTo(id); }}>
                    {name}
                  </a>
                )}
              </span>
            );
          })}
        </nav>
      </header>

      <Ladder level={level} />

      <div className="notice" ref={(el) => { domRefs.notice = el; }}>{ui.noDeeper}</div>

      <div className="hint">
        <span className="zoom-buttons">
          <button onClick={() => zoomBy(-0.7)} aria-label={ui.zoomIn}>＋</button>
          <button onClick={() => zoomBy(0.7)} aria-label={ui.zoomOut}>－</button>
        </span>
        {def.parent && (
          <button className="back" onClick={() => flyTo(def.parent!)}>
            ← {ui.back}
          </button>
        )}
        <span>{text.hint}</span>
        {level === 'cell' && (
          <span className="sim-controls">
            <label>
              <input
                type="checkbox"
                checked={sim.sparseGranules}
                onChange={(e) => setSim({ sparseGranules: e.target.checked })}
              />
              只显示 1/10 的胰岛素颗粒
            </label>
            <label>
              <input type="checkbox" checked={sim.cutaway} onChange={(e) => setSim({ cutaway: e.target.checked })} />
              剖开细胞
            </label>
            <label>
              <input type="checkbox" checked={sim.motion} onChange={(e) => setSim({ motion: e.target.checked })} />
              细胞器运动
            </label>
          </span>
        )}
        {(level === 'atp-synthase' || level === 'catalytic-site') && (
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

      <PhysioPanel />
      <InfoPanel level={level} />
      <div className="badge">{ui.prototype}</div>
    </div>
  );
}

/** Every level on one logarithmic ruler, with a marker for how wide the current view is. */
function Ladder({ level }: { level: LevelId }) {
  return (
    <div className="ladder" aria-label={ui.ladder}>
      <div className="ladder-rail" />
      {ORDER.map((id) => {
        const L = LEVELS[id];
        return (
          <button
            key={id}
            className={id === level ? 'rung current' : 'rung'}
            style={{ top: `${ladderFraction(L.sizeMeters) * 100}%` }}
            onClick={() => flyTo(id)}
          >
            <span className="rung-name">{levelText(L.textKey).name}</span>
            <span className="rung-size">{formatSize(L.sizeMeters)}</span>
          </button>
        );
      })}
      <div className="ladder-marker" ref={(el) => { domRefs.ladderMarker = el; }}>
        <span className="ladder-marker-label">
          {ui.viewWidth} <span ref={(el) => { domRefs.ladderLabel = el; }} />
        </span>
      </div>
    </div>
  );
}

function formatSize(m: number): string {
  if (m >= 1e-6) return `${+(m / 1e-6).toPrecision(2)} µm`;
  return `${+(m / 1e-9).toPrecision(2)} nm`;
}
