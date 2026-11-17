// Glucose control and the chain from glucose to insulin release, read live from the model.
import { useEffect, useRef, useState } from 'react';
import { send, sim, startSim, TRACE_SECONDS } from './client';
import type { Snapshot } from './worker';

const SPEEDS = [1, 10, 60];

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
  const x = (t: number) => w - ((now - t) / TRACE_SECONDS) * w;
  const yV = (v: number) => h - ((v + 75) / 85) * h; // -75..10 mV
  const yC = (cam: number) => h - (Math.min(cam, 1.5) / 1.5) * h;
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.beginPath();
  g.moveTo(0, yV(-20)); g.lineTo(w, yV(-20));
  g.stroke();
  g.strokeStyle = '#7fc8ff';
  g.lineWidth = 1;
  g.beginPath();
  for (const b of sim.trace) {
    const px = x(b.t);
    g.moveTo(px, yV(b.vmin));
    g.lineTo(px, yV(b.vmax) - 0.5);
  }
  g.stroke();
  g.strokeStyle = '#ffb86b';
  g.lineWidth = 1.5;
  g.beginPath();
  sim.trace.forEach((b, i) => (i ? g.lineTo(x(b.t), yC(b.cam)) : g.moveTo(x(b.t), yC(b.cam))));
  g.stroke();
}

function mmss(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function PhysioPanel() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [glucose, setGlucose] = useState(5);
  const [open, setOpen] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    startSim();
    let raf = 0;
    let lastUi = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const s = sim.latest;
      if (!s) return;
      if (canvas.current) drawTrace(canvas.current, s.t);
      if (now - lastUi > 120) {
        lastUi = now;
        setSnap(s);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const s = snap;
  const firing = s ? s.vmaxTick > -20 : false;
  return (
    <section className={open ? 'physio' : 'physio closed'} aria-label="血糖与胰岛素分泌">
      <header>
        <button className="physio-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '−' : '+'}</button>
        <strong>血糖 → 胰岛素分泌</strong>
        <span className="physio-sub">数学模型实时计算</span>
      </header>
      {open && (
        <>
          <label className="glucose">
            <span>血糖</span>
            <input
              type="range" min={2} max={20} step={0.5} value={glucose}
              onChange={(e) => {
                const g = +e.target.value;
                setGlucose(g);
                send({ type: 'set', glucose: g });
              }}
            />
            <b>{glucose.toFixed(1)} mM</b>
          </label>
          <div className="physio-controls">
            {SPEEDS.map((v) => (
              <button key={v} className={s?.speed === v ? 'on' : ''} onClick={() => send({ type: 'set', speed: v })}>{v}×</button>
            ))}
            <button onClick={() => send({ type: 'set', running: !(s?.running ?? true) })}>{s?.running === false ? '继续' : '暂停'}</button>
            <button onClick={() => send({ type: 'reset' })}>重来</button>
            <span className="physio-time">模型时间 {s ? mmss(s.t) : '–'}</span>
          </div>
          {s && (
            <div className="chain">
              <Row label="① 葡萄糖激酶" value={(s.vgk * 1e6).toFixed(1)} unit="µM/s" frac={s.vgk / 0.0000556} note="葡萄糖进入糖酵解的速度" />
              <Row label="② ATP 信号" value={s.a.toFixed(2)} unit="" frac={s.a / 1.5} note="模型里代表 ATP/ADP 的变量" />
              <Row label="③ K(ATP) 通道开放" value={(s.katpOpen * 100).toFixed(0)} unit="%" frac={s.katpOpen} note="ATP 越高，关得越多" />
              <Row label="④ 膜电位" value={s.v.toFixed(0)} unit="mV" frac={(s.vmaxTick + 75) / 85} note={firing ? '正在放电（动作电位）' : '静息'} />
              <Row label="⑤ 膜下钙" value={s.camMaxTick.toFixed(2)} unit="µM" frac={s.camMaxTick / 1.5} note="电压门控钙通道开放后升高" />
              <Row label="⑥ 颗粒融合" value={s.fusionRate.toFixed(1)} unit="个/秒" frac={s.fusionRate / 20} note={`可释放池 ${s.pool.toFixed(0)} 个 · 已释放 ${Math.floor(s.released)} 个`} />
            </div>
          )}
          <div className="trace">
            <canvas ref={canvas} width={300} height={70} />
            <div className="trace-legend"><span className="lv">膜电位</span><span className="lc">膜下钙</span><span>最近 {TRACE_SECONDS} 秒（模型时间）</span></div>
          </div>
        </>
      )}
    </section>
  );
}
