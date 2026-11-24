// Draws up to three levels at once, each in the current level's coordinates:
// the parent around the camera as context, the current level, and the focused child in full detail.
import { useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, type ComponentType, type ReactNode } from 'react';
import * as THREE from 'three';
import { LEVELS, ORDER, type LevelId } from '../content/levels';
import { AtpSynthaseScene } from '../scenes/AtpSynthaseScene';
import { CatalyticSiteScene } from '../scenes/CatalyticSiteScene';
import { CellScene } from '../scenes/CellScene';
import { MitochondrionScene } from '../scenes/MitochondrionScene';
import type { Role, SceneProps } from '../scenes/types';
import { applySwitch } from './Controller';
import { useWorld } from './world';

const SCENES: Record<LevelId, ComponentType<SceneProps>> = {
  cell: CellScene,
  mitochondrion: MitochondrionScene,
  'atp-synthase': AtpSynthaseScene,
  'catalytic-site': CatalyticSiteScene,
};

const IDENTITY = new THREE.Matrix4();

function Frame({ matrix, visible, children }: { matrix: THREE.Matrix4; visible: boolean; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    const g = ref.current!;
    g.matrix.copy(matrix);
    g.matrixWorldNeedsUpdate = true;
  }, [matrix]);
  return (
    <group ref={ref} matrixAutoUpdate={false} visible={visible}>
      {children}
    </group>
  );
}

export function World() {
  const w = useWorld();
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;

  // Re-express the camera in the new level's coordinates in the same commit that swaps the scene graph.
  useLayoutEffect(() => applySwitch(camera), [w.level, camera]);

  const parent = LEVELS[w.level].parent;
  const entry = w.entries[w.level];
  const parentMatrix = useMemo(() => (entry ? entry.matrix.clone().invert() : IDENTITY), [entry]);

  return (
    <>
      {ORDER.map((id) => {
        let role: Role = 'parent';
        let matrix = IDENTITY;
        let visible = false;
        let hidden: number | null = null;
        if (id === w.level) {
          role = 'current';
          visible = true;
          hidden = w.focus && w.revealed ? w.focus.index : null;
        } else if (id === parent && entry) {
          role = 'parent';
          matrix = parentMatrix;
          visible = true;
          hidden = entry.index;
        } else if (w.focus && w.revealed && id === w.focus.child) {
          role = 'child';
          matrix = w.focus.matrix;
          visible = true;
        }
        const Scene = SCENES[id];
        return (
          <Frame key={id} matrix={matrix} visible={visible}>
            <Scene role={role} hidden={hidden} hover={role === 'current' ? w.hover : -1} />
          </Frame>
        );
      })}
    </>
  );
}
