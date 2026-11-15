import type * as THREE from 'three';
import type { LevelId } from '../content/levels';

export interface SceneProps {
  /** Ask the engine to zoom into a child level, flying towards `point` (world coordinates). */
  onZoom: (child: LevelId, point: THREE.Vector3) => void;
}
