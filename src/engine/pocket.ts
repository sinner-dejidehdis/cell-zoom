// A sphere inside which atoms of the space-filling ATP synthase are not drawn, so that the
// ball-and-stick catalytic site inside it can be seen. Shared shader uniforms, set by the controller.
import * as THREE from 'three';

export const pocket = {
  uClipCenter: { value: new THREE.Vector3() },
  uClipRadius: { value: 0 },
};

/** Patch a material used on an InstancedMesh so that instances inside the pocket collapse to nothing. */
export function withPocket(material: THREE.Material): THREE.Material {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uClipCenter = pocket.uClipCenter;
    shader.uniforms.uClipRadius = pocket.uClipRadius;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uClipCenter;\nuniform float uClipRadius;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 centre = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          if (distance(centre.xyz, uClipCenter) < uClipRadius) transformed *= 0.0;
        }`,
      );
  };
  return material;
}

export function inPocket(worldPoint: THREE.Vector3): boolean {
  return pocket.uClipRadius.value > 0 && worldPoint.distanceTo(pocket.uClipCenter.value) < pocket.uClipRadius.value;
}
