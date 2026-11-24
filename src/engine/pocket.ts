// A tunnel (a capsule from the catalytic site to the camera) inside which atoms of the space-filling
// ATP synthase are not drawn, so that the ball-and-stick site at its end can be seen while the rest of
// the protein stays around it. Shared shader uniforms, set by the controller.
import * as THREE from 'three';

export const pocket = {
  uClipCenter: { value: new THREE.Vector3() },
  uClipEnd: { value: new THREE.Vector3() },
  uClipRadius: { value: 0 },
};

/**
 * A sphere around the camera inside which the cell's granules and mitochondria are not drawn. The real
 * cytoplasm is packed (10,000 granules), so without it the camera would see only the nearest granule.
 */
export const nearClip = {
  uClipCenter: { value: new THREE.Vector3() },
  uClipEnd: { value: new THREE.Vector3() },
  uClipRadius: { value: 0 },
};

/** Distance from p to the segment the clip runs along (a sphere when both ends coincide). */
export function clipDistance(clip: typeof pocket, p: THREE.Vector3): number {
  const a = clip.uClipCenter.value;
  const ab = clip.uClipEnd.value.clone().sub(a);
  const len2 = ab.lengthSq();
  const h = len2 > 0 ? THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / len2, 0, 1) : 0;
  return p.distanceTo(a.clone().addScaledVector(ab, h));
}

/** Patch a material used on an InstancedMesh so that instances inside the given sphere collapse to nothing. */
export function withPocket(material: THREE.Material, clip: typeof pocket = pocket): THREE.Material {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uClipCenter = clip.uClipCenter;
    shader.uniforms.uClipRadius = clip.uClipRadius;
    shader.uniforms.uClipEnd = clip.uClipEnd;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uClipCenter;\nuniform vec3 uClipEnd;\nuniform float uClipRadius;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 centre = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec3 ab = uClipEnd - uClipCenter;
          float h = clamp(dot(centre.xyz - uClipCenter, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0);
          if (distance(centre.xyz, uClipCenter + ab * h) < uClipRadius) transformed *= 0.0;
        }`,
      );
  };
  return material;
}

export function inPocket(worldPoint: THREE.Vector3): boolean {
  return pocket.uClipRadius.value > 0 && clipDistance(pocket, worldPoint) < pocket.uClipRadius.value;
}

/** Per-frame switches for context drawn around the current level. */
export const contextDetail = { showNeighbours: true };

/**
 * Patch an ordinary (non-instanced) material so that the part of the surface inside the given sphere is
 * not drawn: a cut-away. Used for the nucleus and Golgi, which the camera may fly through.
 */
export function withCutaway(material: THREE.Material, clip: typeof nearClip = nearClip): THREE.Material {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uClipCenter = clip.uClipCenter;
    shader.uniforms.uClipRadius = clip.uClipRadius;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCutWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;\nuniform vec3 uClipCenter;\nuniform float uClipRadius;')
      .replace('void main() {', 'void main() {\n  if (distance(vCutWorld, uClipCenter) < uClipRadius) discard;');
  };
  material.needsUpdate = true;
  return material;
}

/**
 * The plane that cuts the cell open (world coordinates): fragments with dot(n, p) + w > 0 are not drawn.
 * Set every frame by the cell scene; (0, 0, 0, -1) turns it off.
 */
export const cellCut = { uCutPlane: { value: new THREE.Vector4(0, 0, 0, -1) } };

export function cutRemoves(worldPoint: THREE.Vector3): boolean {
  const c = cellCut.uCutPlane.value;
  return c.x * worldPoint.x + c.y * worldPoint.y + c.z * worldPoint.z + c.w > 0;
}

/** Add the cell's cut plane to a material, on top of any patch it already has. Works for meshes,
 * instanced meshes, points and lines. Cut solids show their inside, so the material becomes two-sided. */
export function withPlaneCut<T extends THREE.Material>(material: T): T {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.uniforms.uCutPlane = cellCut.uCutPlane;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPlaneWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vPlaneWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vPlaneWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPlaneWorld;\nuniform vec4 uCutPlane;')
      .replace('void main() {', 'void main() {\n  if (dot(uCutPlane.xyz, vPlaneWorld) + uCutPlane.w > 0.0) discard;');
  };
  material.customProgramCacheKey = () => prevKey + '|planecut';
  if (!(material instanceof THREE.PointsMaterial) && !(material instanceof THREE.LineBasicMaterial)) material.side = THREE.DoubleSide;
  material.needsUpdate = true;
  return material;
}
