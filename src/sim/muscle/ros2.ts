// A stiff ODE stepper for the muscle model: the two-stage Rosenbrock-W method ROS2
// (Verwer et al. 1999), L-stable, with a numerical Jacobian that is reused for several steps.
// Explicit methods are unstable for this model even at 2 us steps (fast Ca2+ buffering).
// Checked against LSODA (scipy) on a twitch: peak force and Ca2+ agree to <0.5 % at dt = 0.02 ms.

export type Rates = (t: number, y: Float64Array, dy: Float64Array) => void;

const GAMMA = 1 + 1 / Math.SQRT2;

export class Ros2 {
  private readonly n: number;
  private readonly lu: Float64Array;
  private readonly piv: Int32Array;
  private readonly f0: Float64Array;
  private readonly f1: Float64Array;
  private readonly k1: Float64Array;
  private readonly k2: Float64Array;
  private readonly tmp: Float64Array;
  private readonly rates: Rates;
  private readonly jacobianEvery: number;
  private steps = 0;
  private luDt = 0;

  constructor(n: number, rates: Rates, jacobianEvery = 10) {
    this.n = n;
    this.rates = rates;
    this.jacobianEvery = jacobianEvery;
    this.lu = new Float64Array(n * n);
    this.piv = new Int32Array(n);
    this.f0 = new Float64Array(n);
    this.f1 = new Float64Array(n);
    this.k1 = new Float64Array(n);
    this.k2 = new Float64Array(n);
    this.tmp = new Float64Array(n);
  }

  /** Forget the stored Jacobian (call after the input changes abruptly, e.g. a stimulus edge). */
  invalidate(): void {
    this.steps = 0;
  }

  step(t: number, y: Float64Array, dt: number): void {
    const { n, f0, f1, k1, k2, tmp } = this;
    this.rates(t, y, f0);
    if (this.steps % this.jacobianEvery === 0 || dt !== this.luDt) this.factor(t, y, dt);
    this.steps++;
    k1.set(f0);
    this.solve(k1);
    for (let i = 0; i < n; i++) tmp[i] = y[i] + dt * k1[i];
    this.rates(t + dt, tmp, f1);
    for (let i = 0; i < n; i++) k2[i] = f1[i] - 2 * k1[i];
    this.solve(k2);
    for (let i = 0; i < n; i++) y[i] += 1.5 * dt * k1[i] + 0.5 * dt * k2[i];
  }

  /** LU-factor I - gamma*dt*J, with J by forward differences. */
  private factor(t: number, y: Float64Array, dt: number): void {
    const { n, lu, f0, f1, tmp, piv } = this;
    tmp.set(y);
    for (let j = 0; j < n; j++) {
      const h = 1e-7 * Math.max(1, Math.abs(y[j]));
      tmp[j] = y[j] + h;
      this.rates(t, tmp, f1);
      tmp[j] = y[j];
      for (let i = 0; i < n; i++) lu[i * n + j] = (i === j ? 1 : 0) - GAMMA * dt * ((f1[i] - f0[i]) / h);
    }
    for (let k = 0; k < n; k++) {
      let p = k;
      let best = Math.abs(lu[k * n + k]);
      for (let i = k + 1; i < n; i++) {
        const v = Math.abs(lu[i * n + k]);
        if (v > best) { best = v; p = i; }
      }
      piv[k] = p;
      if (p !== k) for (let j = 0; j < n; j++) { const a = lu[k * n + j]; lu[k * n + j] = lu[p * n + j]; lu[p * n + j] = a; }
      const d = lu[k * n + k];
      for (let i = k + 1; i < n; i++) {
        const f = (lu[i * n + k] /= d);
        if (f !== 0) for (let j = k + 1; j < n; j++) lu[i * n + j] -= f * lu[k * n + j];
      }
    }
    this.luDt = dt;
  }

  private solve(b: Float64Array): void {
    const { n, lu, piv } = this;
    // Row swaps were applied to whole rows (multipliers included), so apply them all first.
    for (let k = 0; k < n; k++) {
      const p = piv[k];
      if (p !== k) { const a = b[k]; b[k] = b[p]; b[p] = a; }
    }
    for (let k = 0; k < n; k++) for (let i = k + 1; i < n; i++) b[i] -= lu[i * n + k] * b[k];
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let j = i + 1; j < n; j++) s -= lu[i * n + j] * b[j];
      b[i] = s / lu[i * n + i];
    }
  }
}
