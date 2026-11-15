/**
 * How a level is being drawn:
 * current – the level the camera is in; parent – drawn around it as context;
 * child – the focused part of the current level, drawn in full detail at its true place and size.
 */
export type Role = 'current' | 'parent' | 'child';

export interface SceneProps {
  role: Role;
  /** Child instance to leave out, because its detailed version is drawn in its place. */
  hidden: number | null;
  /** Child instance under the pointer (only meaningful for the current level). */
  hover: number;
}
