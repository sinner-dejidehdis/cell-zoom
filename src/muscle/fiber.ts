// A segment of one human skeletal muscle fibre, in micrometres. Fibre axis = X, centred on the origin.
// Everything that sits at a fixed place in a sarcomere (Z-discs, M-lines, triads, filaments, I-band
// mitochondria) carries its sarcomere number and anchor, and the vertex shader puts it where that place
// is for the current sarcomere length. A-band width (thick filaments) stays fixed while I-band and H-zone
// shrink: the sliding-filament rule falls out of the geometry, it is not animated by hand.
import * as THREE from 'three';
import { rng } from '../scenes/util';

export const FIBER = {
  /** Sarcomere length at rest (um): illustrative, near the optimum reported for human muscle (~2.6-2.8). */
  slRest: 2.6,
  /** Sarcomere length at full force when the fibre may shorten (illustrative). */
  slShort: 2.0,
  /** Thick filament length (um), ~1.6 in vertebrate muscle. */
  thick: 1.6,
  /** Bare zone at the thick filament centre without myosin heads (um), ~0.16. */
  bare: 0.16,
  /** Thin filament length from the Z-disc (um): 1.19-1.37 in human biopsies (Gokhin 2012); mid value. */
  thin: 1.27,
  sarcomeres: 24,
  /** Fibre radius (um); illustrative (human fibres are of order tens of um across, very variable). */
  radius: 25,
  myofibrilRadius: 0.5,
  /** Centre spacing of myofibrils (um): leaves room for SR, T-tubules and mitochondria between them. */
  spacing: 1.3,
  /** Space under the membrane without myofibrils, for nuclei and subsarcolemmal mitochondria. */
  rim: 2.2,
  /** Thick-filament lattice spacing (um), ~45 nm between neighbouring thick filaments. */
  lattice: 0.045,
};

export const L0 = FIBER.sarcomeres * FIBER.slRest;

/** Uniforms shared by every fibre material; written each frame from the model. */
export const fiberU = {
  uSL: { value: FIBER.slRest },
  uCut: { value: 1 },
  uCa: { value: 0 },
  uV: { value: -82 },
  uVT: { value: -82 },
  uAttached: { value: 0 },
  uTime: { value: 0 },
};

/** Is a point (fibre-local, um) in the opened wedge? The wedge is y > 0 and z > 0, with a small margin. */
export function inWedge(y: number, z: number, margin = 0): boolean {
  return y > -margin && z > -margin;
}

/**
 * Patch a material for fibre instances. Geometry is built at rest length; instances with `aSarc`
 * (sarcomere index k, anchor 0 = Z-disc / 1 = M-line, offset dx in um) are moved along X each frame.
 * `banded` adds the myofibril striation pattern. Everything in the opened wedge is not drawn.
 */
export function fiberMaterial<T extends THREE.Material>(material: T, opts: { sarc?: boolean; banded?: boolean; heads?: boolean; key: string }): T {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fiberU);
    const common = `
      uniform float uSL; uniform float uCut; uniform float uCa; uniform float uV; uniform float uVT; uniform float uAttached; uniform float uTime;
      varying vec3 vFiber;
      ${opts.sarc ? 'attribute vec3 aSarc;' : ''}
      ${opts.heads ? 'attribute vec3 aHead; varying float vAttached;' : ''}
      ${opts.banded ? 'varying float vReal;' : ''}
    `;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + common).replace(
      '#include <project_vertex>',
      `
      vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      // Rest-length local coordinates: the group is scaled by uSL / ${FIBER.slRest.toFixed(2)} along X.
      float toLocal = ${FIBER.slRest.toFixed(3)} / uSL;
      ${opts.sarc ? `
        float realX = aSarc.x * uSL + aSarc.y * 0.5 * uSL + aSarc.z - ${FIBER.sarcomeres.toFixed(1)} * 0.5 * uSL;
        mvPosition.x += realX * toLocal;` : ''}
      ${opts.heads ? `
        // Myosin heads: a share uAttached of them, picked by a fixed hash, reach out to the thin filament.
        float h = fract(sin(dot(aHead.xy, vec2(12.9898, 78.233)) + aHead.z * 3.1) * 43758.5453);
        vAttached = step(h, uAttached);
        mvPosition.yz += normalize(aHead.xy) * (0.004 + 0.006 * vAttached);` : ''}
      ${opts.banded ? `vReal = mvPosition.x / toLocal + ${FIBER.sarcomeres.toFixed(1)} * 0.5 * uSL;` : ''}
      vFiber = mvPosition.xyz;
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;
      `,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + common.replace(/attribute [^;]+;/g, ''))
      .replace('void main() {', `void main() {\n  if (uCut > 0.5 && vFiber.y > 0.0 && vFiber.z > 0.0) discard;`);
    if (opts.banded) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float s = mod(vReal, uSL);
          float d = min(s, uSL - s);                // distance from the nearest Z-disc
          float hs = 0.5 * uSL;
          float thick = step(hs - ${(FIBER.thick / 2).toFixed(3)}, d);  // inside the A band
          float thin = step(d, ${FIBER.thin.toFixed(3)});                 // reached by thin filaments
          // Stain-like colours: pale I band, dark A band (darkest where filaments overlap), lighter H zone.
          vec3 col = vec3(0.95, 0.80, 0.74);                       // I band
          col = mix(col, vec3(0.55, 0.13, 0.12), thick * thin);    // A band, overlap
          col = mix(col, vec3(0.74, 0.30, 0.26), thick * (1.0 - thin)); // H zone
          col = mix(col, vec3(0.20, 0.07, 0.07), 1.0 - step(0.035, d));  // Z-disc
          col = mix(col, vec3(0.40, 0.10, 0.10), 1.0 - step(0.025, abs(d - hs))); // M-line
          diffuseColor.rgb = col;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.62, 0.25), 0.25 * uCa);
        }`,
      );
    }
    if (opts.heads) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.85, 0.3), vAttached);`,
      );
    }
  };
  material.customProgramCacheKey = () => 'fiber-' + opts.key;
  material.needsUpdate = true;
  return material;
}

// ---- Layout ----

export interface FiberLayout {
  myofibrils: { y: number; z: number }[];
  /** The myofibril drawn as individual filaments instead of a solid striated rod. */
  detailed: { y: number; z: number };
  /** Myofibrils near the cut faces, which get triads drawn around them. */
  nearCut: { y: number; z: number }[];
  /** Spaces between three myofibrils, near the cut faces: where I-band mitochondria sit. */
  gaps: { y: number; z: number }[];
  nuclei: { y: number; z: number; x: number; angle: number }[];
}

function visible(y: number, z: number, depth: number): boolean {
  // Within `depth` of a cut face (inside the remaining fibre) or of the membrane.
  const R = FIBER.radius;
  const nearFace = (y > 0 && z <= 0 && z > -depth) || (z > 0 && y <= 0 && y > -depth) || (y <= 0 && z <= 0 && y > -depth && z > -depth);
  return nearFace || Math.hypot(y, z) > R - FIBER.rim - depth;
}

export const LAYOUT: FiberLayout = (() => {
  const { spacing, radius, rim, myofibrilRadius } = FIBER;
  const lim = radius - rim - myofibrilRadius;
  const myofibrils: { y: number; z: number }[] = [];
  const dz = spacing * Math.sqrt(3) / 2;
  for (let j = -Math.ceil(lim / dz); j <= Math.ceil(lim / dz); j++) {
    for (let i = -Math.ceil(lim / spacing) - 1; i <= Math.ceil(lim / spacing) + 1; i++) {
      // Offset so that no myofibril sits exactly on a cut plane.
      const y = (i + (j & 1 ? 0.5 : 0) + 0.3) * spacing;
      const z = j * dz + 0.37;
      if (Math.hypot(y, z) <= lim) myofibrils.push({ y, z });
    }
  }
  const keep = myofibrils.filter((m) => !inWedge(m.y, m.z, -myofibrilRadius));
  // The detailed one: on the z = 0 face, about a third of the way out.
  const detailed = keep.filter((m) => m.y > 0 && m.z < 0).sort((a, b) => Math.abs(a.z + 0.6) + Math.abs(a.y - radius * 0.35) * 0.05 - (Math.abs(b.z + 0.6) + Math.abs(b.y - radius * 0.35) * 0.05))[0];
  const nearCut = keep.filter((m) => visible(m.y, m.z, 1.6) && m !== detailed);
  const gaps: { y: number; z: number }[] = [];
  for (const m of keep) {
    for (const [gy, gz] of [[spacing / 2, dz / 3], [0, (2 * dz) / 3]]) {
      const y = m.y + gy, z = m.z + gz;
      if (Math.hypot(y, z) < lim && !inWedge(y, z, -0.2) && visible(y, z, 1.6)) gaps.push({ y, z });
    }
  }
  const r = rng(41);
  const nuclei = Array.from({ length: 6 }, (_, i) => ({
    x: (i / 6 - 0.5 + r() * 0.12) * L0 * 0.9,
    angle: i * 2.4 + r() * 0.6,
    y: 0,
    z: 0,
  })).map((n) => ({ ...n, y: Math.cos(n.angle) * (radius - 1.1), z: Math.sin(n.angle) * (radius - 1.1) }));
  return { myofibrils: keep.filter((m) => m !== detailed), detailed, nearCut, gaps, nuclei };
})();
