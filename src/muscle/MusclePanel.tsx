// Stimulation controls and the chain from nerve impulse to force, read live from the muscle model.
import { useEffect, useRef, useState } from 'react';
import { muscle, sendMuscle, startMuscle, TRACE_MS } from '../sim/muscle/client';
import type { MuscleSnapshot } from '../sim/muscle/worker';

const SPEEDS: [number, string][] = [[0.02, '1/50'], [0.05, '1/20'], [0.2, '1/5']];
const RATES = [10, 20, 50, 100];

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
  const line = (color: string, y: (s: number[]) => number, width = 1.2) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    muscle.trace.forEach((s, i) => (i ? g.lineTo(x(s[0]), y(s)) : g.moveTo(x(s[0]), y(s))));
    g.stroke();
  };
  line('#7fc8ff', (s) => h - ((s[1] + 90) / 130) * h); // -90..40 mV
  line('#ffb86b', (s) => h - (Math.min(s[2], 6) / 6) * h); // 0..6 uM
  line('#ff6b6b', (s) => h - Math.min(s[3], 1.1) / 1.1 * h, 2);
}

export function MusclePanel() {
  const [snap, setSnap] = useState<MuscleSnapshot | null>(null);
  const [open, setOpen] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    startMuscle();
    let raf = 0, last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const s = muscle.latest;
      if (s && canvas.current) drawTrace(canvas.current, s.t);
      if (now - last > 120) {
        last = now;
        setSnap(s);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const s = snap;
  return (
    <section className={open ? 'physio' : 'physio closed'} aria-label="神经冲动 → 肌肉收缩">
      <header>
        <button className="physio-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '−' : '+'}</button>
        <strong>神经冲动 → 肌肉收缩</strong>
        <span className="physio-sub">数学模型实时计算</span>
      </header>
      {open && (
        <>
          <div className="physio-controls">
            <button className="primary" onClick={() => sendMuscle({ type: 'twitch' })}>单次刺激</button>
            <button className={s?.train ? 'on' : ''} onClick={() => sendMuscle({ type: 'train', on: !s?.train })}>
              {s?.train ? '停止连续刺激' : '连续刺激'}
            </button>
            {RATES.map((hz) => (
              <button key={hz} className={s?.hz === hz ? 'on' : ''} onClick={() => sendMuscle({ type: 'train', on: !!s?.train, hz })}>{hz} Hz</button>
            ))}
          </div>
          <div className="physio-controls">
            慢放
            {SPEEDS.map(([v, l]) => (
              <button key={v} className={s?.speed === v ? 'on' : ''} onClick={() => sendMuscle({ type: 'set', speed: v })}>{l}</button>
            ))}
            <button onClick={() => sendMuscle({ type: 'set', running: !s?.running })}>{s?.running === false ? '继续' : '暂停'}</button>
            <button onClick={() => sendMuscle({ type: 'reset' })}>重来</button>
            <span className="physio-time">模型时间 {s ? (s.t / 1000).toFixed(3) : '–'} s{s?.idle ? '（静息）' : ''}</span>
          </div>
          {s && (
            <div className="chain">
              <Row label="① 肌膜电位" note="动作电位沿肌膜传开" value={s.v.toFixed(0)} unit="mV" frac={(s.v + 90) / 130} />
              <Row label="② T 管膜电位" note="电信号传入细胞深处" value={s.vT.toFixed(0)} unit="mV" frac={(s.vT + 90) / 130} />
              <Row label="③ 肌浆钙" note="肌质网释放 Ca²⁺" value={s.ca.toFixed(2)} unit="µM" frac={s.ca / 6} />
              <Row label="④ 力" note="横桥拉动细肌丝滑动" value={(s.force * 100).toFixed(0)} unit="%" frac={s.force} />
              <Row label="⑤ 无机磷酸" note="越用越多，拖慢横桥（疲劳）" value={s.p.toFixed(2)} unit="mM" frac={s.p / 10} />
            </div>
          )}
          <div className="trace">
            <canvas ref={canvas} width={300} height={70} />
            <div className="trace-legend">
              <span style={{ color: '#7fc8ff' }}>膜电位</span><span style={{ color: '#ffb86b' }}>肌浆钙</span><span style={{ color: '#ff6b6b' }}>力</span><span>最近 {TRACE_MS} ms（模型时间）</span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
