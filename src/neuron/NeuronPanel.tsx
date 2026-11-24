// Inputs and readouts of the neuron model: synaptic input rate, injected current, and the chain from
// synaptic release to the spike leaving along the axon.
import { useEffect, useRef, useState } from 'react';
import { neuron, sendNeuron, startNeuron, TRACE_MS } from '../sim/neuron/client';
import type { NeuronSnapshot } from '../sim/neuron/worker';
import { N_SYNAPSES } from '../sim/neuron/synapses';
import { CELL, FEATURED } from './geometry';

const SPEEDS: [number, string][] = [[0.001, '1/1000'], [0.02, '1/50'], [0.05, '1/20'], [0.2, '1/5']];
const P_RELEASE = 0.5;

function Row({ label, value, unit, frac, note }: { label: string; value: string; unit: string; frac: number; note?: string }) {
  return (
    <div className="chain-row">
      <span className="chain-label">{label}</span>
      <span className="chain-bar"><span style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%` }} /></span>
      <span className="chain-value">{value}<small> {unit}</small></span>
      {note && <span className="chain-note">{note}</span>}
    </div>
  );
}

function drawTrace(c: HTMLCanvasElement, now: number) {
  const g = c.getContext('2d');
  if (!g) return;
  const w = c.width, h = c.height;
  g.clearRect(0, 0, w, h);
  const x = (t: number) => w - ((now - t) / TRACE_MS) * w;
  const y = (v: number) => h - ((Math.max(-85, Math.min(45, v)) + 85) / 130) * h;
  g.strokeStyle = 'rgba(255,255,255,0.15)';
  g.beginPath(); g.moveTo(0, y(-70)); g.lineTo(w, y(-70)); g.stroke();
  const line = (color: string, k: 1 | 2, width: number) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    neuron.trace.forEach((s, i) => (i ? g.lineTo(x(s[0]), y(s[k])) : g.moveTo(x(s[0]), y(s[k]))));
    g.stroke();
  };
  line('#ffb86b', 2, 1.2);
  line('#7fc8ff', 1, 1.6);
}

export function NeuronPanel() {
  const [snap, setSnap] = useState<NeuronSnapshot | null>(null);
  const [open, setOpen] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    startNeuron();
    let raf = 0, last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const s = neuron.latest;
      if (s && canvas.current) drawTrace(canvas.current, s.t);
      if (now - last > 120) { last = now; setSnap(s); }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const s = snap;
  const lastTrace = neuron.trace[neuron.trace.length - 1];
  const releasesPerS = s ? N_SYNAPSES * s.rate * P_RELEASE : 0;
  return (
    <section className={open ? 'physio' : 'physio closed'} aria-label="突触输入 → 放电">
      <header>
        <button className="physio-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '−' : '+'}</button>
        <strong>突触输入 → 神经元放电</strong>
        <span className="physio-sub">数学模型实时计算</span>
      </header>
      {open && (
        <>
          <label className="physio-slider">
            <span>每根输入纤维的放电频率</span>
            <input type="range" min={0} max={40} step={1} value={s?.rate ?? 15} onChange={(e) => sendNeuron({ type: 'set', rate: +e.target.value })} />
            <b>{s?.rate ?? 15} Hz</b>
          </label>
          <label className="physio-slider">
            <span>向胞体注入电流</span>
            <input type="range" min={0} max={0.5} step={0.05} value={s?.iclamp ?? 0} onChange={(e) => sendNeuron({ type: 'set', iclamp: +e.target.value })} />
            <b>{(s?.iclamp ?? 0).toFixed(2)} nA</b>
          </label>
          <div className="physio-controls">
            慢放
            {SPEEDS.map(([v, l]) => (
              <button key={v} className={s?.speed === v ? 'on' : ''} onClick={() => sendNeuron({ type: 'set', speed: v })}>{l}</button>
            ))}
            <button onClick={() => sendNeuron({ type: 'set', running: !s?.running })}>{s?.running === false ? '继续' : '暂停'}</button>
            <button onClick={() => sendNeuron({ type: 'reset' })}>重来</button>
          </div>
          <div className="physio-controls">
            <button className="primary" onClick={() => sendNeuron({ type: 'release', index: FEATURED })}>放大的那个突触释放一次</button>
            <span className="physio-time">模型时间 {s ? (s.t / 1000).toFixed(3) : '–'} s</span>
          </div>
          {s && (
            <div className="chain">
              <Row label="① 突触释放" note={`${N_SYNAPSES} 个输入突触合计，每次放 1 个小泡（示意）`} value={releasesPerS.toFixed(0)} unit="次/秒" frac={releasesPerS / 6000} />
              <Row label="② 顶树突电位" note="离胞体约 400 µm，突触电流在树突上叠加" value={lastTrace ? lastTrace[2].toFixed(0) : '–'} unit="mV" frac={lastTrace ? (lastTrace[2] + 85) / 130 : 0} />
              <Row label="③ 胞体电位" note="越过阈值后，轴突先触发动作电位，再传回胞体" value={s.v[0].toFixed(0)} unit="mV" frac={(s.v[0] + 85) / 130} />
              <Row label="④ 轴突末端电位" note="动作电位沿有髓轴突跳跃传导" value={s.v[CELL.axonEnd].toFixed(0)} unit="mV" frac={(s.v[CELL.axonEnd] + 85) / 130} />
              <Row label="⑤ 放电频率" note="最近 0.5 s（模型时间）" value={s.firing.toFixed(0)} unit="Hz" frac={s.firing / 60} />
            </div>
          )}
          <div className="trace">
            <canvas ref={canvas} width={300} height={70} />
            <div className="trace-legend">
              <span style={{ color: '#7fc8ff' }}>胞体</span><span style={{ color: '#ffb86b' }}>顶树突</span><span>最近 {TRACE_MS} ms（模型时间），横线 −70 mV</span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
