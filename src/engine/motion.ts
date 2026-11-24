// Movement inside the cell, in real time (1 s on screen = 1 s in the cell), independent of the speed
// the electrical model runs at. Shared clock plus two shader patches:
//   withWobble  - membranes (ER, Golgi, envelope, plasma membrane...) bend slowly: a smooth displacement
//                 field of position, so neighbouring vertices move together and nothing tears.
//   withJitter  - small independent particles (free ribosomes) shake, each with its own phase.
// Amplitudes are illustrative (a few tens of nanometres); see the cell panel text.
import * as THREE from 'three';

export const motionClock = { uMotionTime: { value: 0 } };

/** Advance the clock; called once per frame by the cell scene while motion is on. */
export function tickMotion(dt: number): void {
  motionClock.uMotionTime.value += dt;
}

function compose<T extends THREE.Material>(material: T, key: string, patch: (shader: THREE.WebGLProgramParametersWithUniforms) => void): T {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.uniforms.uMotionTime = motionClock.uMotionTime;
    patch(shader);
  };
  material.customProgramCacheKey = () => prevKey + '|' + key;
  material.needsUpdate = true;
  return material;
}

/**
 * Bend a surface by `amp` (in the mesh's own units) with a slow travelling field. Spatial wavelength
 * about `wavelength` units, period about `period` seconds.
 */
export function withWobble<T extends THREE.Material>(material: T, amp: number, wavelength = 1.5, period = 6): T {
  if (amp <= 0) return material;
  const k = (2 * Math.PI) / wavelength;
  const w = (2 * Math.PI) / period;
  return compose(material, `wobble${amp}_${wavelength}_${period}`, (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uMotionTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 p = position * ${k.toFixed(5)};
          float t = uMotionTime * ${w.toFixed(5)};
          transformed += ${amp.toFixed(5)} * vec3(
            sin(p.y + 0.7 * p.z + t) + 0.5 * sin(1.9 * p.z - 1.3 * t + 1.0),
            sin(p.z + 0.6 * p.x + 1.1 * t + 2.0) + 0.5 * sin(1.7 * p.x - 0.9 * t),
            sin(p.x + 0.8 * p.y + 0.9 * t + 4.0) + 0.5 * sin(2.1 * p.y - 1.2 * t + 3.0)
          ) / 1.5;
        }`,
      );
  });
}

/** Shake each vertex independently by up to `amp` units, a few times a second (points). */
export function withJitter<T extends THREE.Material>(material: T, amp: number, hz = 1.5): T {
  const w = 2 * Math.PI * hz;
  return compose(material, `jitter${amp}_${hz}`, (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uMotionTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 h = fract(sin(position * vec3(127.1, 311.7, 74.7) + position.yzx * 13.3) * 43758.5453) * 6.2832;
          float t = uMotionTime * ${w.toFixed(5)};
          transformed += ${amp.toFixed(5)} * vec3(
            sin(t * (0.8 + 0.1 * h.x) + h.y) + 0.5 * sin(t * 2.3 + h.z),
            sin(t * (0.9 + 0.1 * h.y) + h.z) + 0.5 * sin(t * 1.9 + h.x),
            sin(t * (0.7 + 0.1 * h.z) + h.x) + 0.5 * sin(t * 2.7 + h.y)
          ) / 1.5;
        }`,
      );
  });
}

/** A cheap normal deviate (sum of four uniforms, unit variance). */
export function roughGauss(): number {
  return (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.7320508;
}

// Granule motion, from TIRF tracking of INS-1 cells (a rat beta-cell line), granules near the membrane,
// 60 s movies (Heaslip et al. 2014, PLoS ONE, PMC4195697, Table 1 and Fig. 2):
//   2.8 mM glucose: 12 % of granules made a directed run during the 60 s, 1.19 um/s; others D = 1514 nm2/s
//   20 mM glucose:  24 %,                                                1.16 um/s;          D = 2325 nm2/s
// Not measured there, so illustrative here: how long a run lasts (2 s) and the cage size; that the same
// numbers hold deep in the cell and in human cells.
export const MOTION = {
  runSpeed: 1.2,
  runSeconds: 2,
  /** Caged jitter relaxes over this time (s); its size is set so short-time diffusion matches D. */
  cageTau: 1.0,
};

const lerpG = (glucose: number) => THREE.MathUtils.clamp((glucose - 2.8) / (20 - 2.8), 0, 1);

/** Rate (per granule, per second) at which directed runs start: 12 % or 24 % of granules within 60 s. */
export function runStartRate(glucose: number): number {
  const share60 = 0.12 + 0.12 * lerpG(glucose);
  return -Math.log(1 - share60) / 60;
}

/** Diffusion coefficient of the caged jitter, um2/s. */
export function cageDiffusion(glucose: number): number {
  return (1514 + (2325 - 1514) * lerpG(glucose)) * 1e-6;
}
