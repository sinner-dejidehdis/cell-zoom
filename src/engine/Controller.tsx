// The camera: drag to orbit, wheel to zoom toward whatever is under the cursor, click to fly into a part.
// Zooming is continuous across levels. When the camera gets close enough to a child, the camera's
// position is re-expressed in the child's coordinates (see anchors.ts); the picture does not change at
// that moment, so there is no cut and no fade.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { LEVELS, childOf, pathTo, type LevelId } from '../content/levels';
import { CELL_LAYOUT, anchorCenters, homeCamera, makeAnchor, type Anchor } from './anchors';
import { nearClip, pocket } from './pocket';
import { domRefs, getSim } from './store';
import { getWorld, setWorld } from './world';

type Autopilot =
  /** Fly into `anchor` (a child of the current level), then keep going until `goal`. */
  | { kind: 'in'; anchor: Anchor | null; goal: LevelId }
  | { kind: 'out'; goal: LevelId }
  /** Ease to the current level's resting view. */
  | { kind: 'settle' };

export const view = {
  target: new THREE.Vector3(),
  up: new THREE.Vector3(0, 1, 0),
  pivot: new THREE.Vector3(),
  /** Natural log of the distance factor the wheel has asked for and that is not yet applied. */
  pendingZoom: 0,
  autopilot: null as Autopilot | null,
  /** Coordinate change waiting for React to swap the scene graph to the new level. */
  switching: null as THREE.Matrix4 | null,
  noticeUntil: 0,
};

/** Fly to any level on the chain (an ancestor or a descendant of the current one). */
export function flyTo(goal: LevelId): void {
  const w = getWorld();
  if (goal === w.level) view.autopilot = { kind: 'settle' };
  else if (pathTo(w.level).includes(goal)) view.autopilot = { kind: 'out', goal };
  else if (pathTo(goal).includes(w.level)) view.autopilot = { kind: 'in', anchor: null, goal };
  view.pendingZoom = 0;
}

/** Fly into child instance `index` of the current level. */
export function flyInto(index: number, camera: THREE.Camera): void {
  const w = getWorld();
  const child = childOf(w.level);
  if (!child) return;
  const anchor = w.focus?.index === index ? w.focus : reuseOrMake(w.level, index, camera.position);
  view.autopilot = { kind: 'in', anchor, goal: child };
  view.pendingZoom = 0;
  setWorld({ focus: anchor, revealed: w.revealed && w.focus?.index === index });
}

function reuseOrMake(level: LevelId, index: number, cam: THREE.Vector3): Anchor {
  const child = childOf(level)!;
  const known = getWorld().entries[child];
  return known && known.index === index ? known : makeAnchor(level, index, cam);
}

function nearestIndex(level: LevelId, p: THREE.Vector3): { index: number; dist: number } {
  let index = -1;
  let dist = Infinity;
  anchorCenters(level).forEach((c, i) => {
    const d = c.distanceTo(p);
    if (d < dist) {
      dist = d;
      index = i;
    }
  });
  return { index, dist };
}

const raycaster = new THREE.Raycaster();

/** First visible, solid surface under a screen point (translucent shells are skipped). */
function raycastScene(scene: THREE.Scene, camera: THREE.Camera, ndc: THREE.Vector2): THREE.Intersection | null {
  raycaster.setFromCamera(ndc, camera);
  const hits: THREE.Intersection[] = [];
  const visit = (o: THREE.Object3D) => {
    if (!o.visible) return;
    if (!o.userData.noPivot) o.raycast(raycaster, hits);
    o.children.forEach(visit);
  };
  scene.children.forEach(visit);
  hits.sort((a, b) => a.distance - b.distance);
  // Markers drawn on top of everything (the catalytic-site beacon) win even when atoms are in front.
  return hits.find((h) => h.object.userData.pivotPriority) ?? hits.find((h) => Number.isFinite(h.distance)) ?? null;
}

/** Which child of the current level is under the pointer: a direct hit, or the nearest marker within 16 px. */
function pickAnchor(scene: THREE.Scene, camera: THREE.Camera, ndc: THREE.Vector2, size: { width: number; height: number }): number {
  const level = getWorld().level;
  const hit = raycastScene(scene, camera, ndc);
  if (hit && hit.object.userData.anchorLevel === level) return hit.instanceId ?? hit.object.userData.anchorIndex ?? -1;
  let best = -1;
  let bestPx = 16;
  const v = new THREE.Vector3();
  anchorCenters(level).forEach((c, i) => {
    v.copy(c).project(camera);
    if (v.z > 1 || v.z < -1) return;
    const px = Math.hypot(((v.x - ndc.x) * size.width) / 2, ((v.y - ndc.y) * size.height) / 2);
    if (px < bestPx) {
      bestPx = px;
      best = i;
    }
  });
  return best;
}

function zoomAbout(camera: THREE.Camera, p: THREE.Vector3, logFactor: number) {
  const f = Math.exp(logFactor);
  camera.position.sub(p).multiplyScalar(f).add(p);
  view.target.sub(p).multiplyScalar(f).add(p);
}

/** Called by World in a layout effect, right after React has put the new level's scene graph in place. */
export function applySwitch(camera: THREE.PerspectiveCamera): void {
  const m = view.switching;
  if (!m) return;
  camera.position.applyMatrix4(m);
  view.target.applyMatrix4(m);
  view.pivot.applyMatrix4(m);
  view.up.transformDirection(m);
  camera.up.copy(view.up);
  camera.lookAt(view.target);
  camera.updateMatrixWorld();
  view.switching = null;
}

const NICE = [1, 2, 5];
function formatLength(m: number): string {
  if (m >= 1e-6) return `${+(m / 1e-6).toPrecision(3)} µm`;
  if (m >= 1e-9) return `${+(m / 1e-9).toPrecision(3)} nm`;
  return `${+(m / 1e-10).toPrecision(3)} Å`;
}
// The scale ladder spans 100 µm (top) to 0.5 nm (bottom), on a log scale.
export const LADDER_TOP = 1e-4;
export const LADDER_BOTTOM = 5e-10;
export function ladderFraction(m: number): number {
  const f = (Math.log10(LADDER_TOP) - Math.log10(m)) / (Math.log10(LADDER_TOP) - Math.log10(LADDER_BOTTOM));
  return Math.min(1, Math.max(0, f));
}

export function Controller() {
  const { camera, gl, scene, size } = useThree();
  const cam = camera as THREE.PerspectiveCamera;

  useLayoutEffect(() => {
    const level = getWorld().level;
    cam.position.copy(homeCamera(level));
    view.target.set(...LEVELS[level].viewCenter);
    view.up.set(0, 1, 0);
    cam.up.copy(view.up);
    cam.lookAt(view.target);
  }, [cam]);

  // A small hook for automated checks (screenshots of a zoom sequence); it changes nothing by itself.
  useEffect(() => {
    (window as unknown as { __cellZoom: unknown }).__cellZoom = {
      state: () => ({ level: getWorld().level, d: cam.position.distanceTo(view.target), focus: getWorld().focus?.index ?? null, revealed: getWorld().revealed, ap: view.autopilot?.kind ?? null, pz: view.pendingZoom, t: view.target.toArray().map(Math.round), site: anchorCenters('atp-synthase')[0].toArray().map(Math.round) }),
      anchorOnScreen: (i: number) => {
        const v = anchorCenters(getWorld().level)[i].clone().project(cam);
        return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height, z: v.z };
      },
      anchors: () => anchorCenters(getWorld().level).length,
      placed: () => [CELL_LAYOUT.mitos.length, CELL_LAYOUT.granules.length],
    };
  }, [cam, size]);

  // Pointer input.
  useEffect(() => {
    const el = gl.domElement;
    let drag: { x: number; y: number; moved: number; id: number } | null = null;
    const ndcOf = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const orbit = (dx: number, dy: number) => {
      const k = 0.006;
      const off = cam.position.clone().sub(view.target);
      off.applyAxisAngle(view.up, -dx * k);
      const angle = off.angleTo(view.up);
      const next = THREE.MathUtils.clamp(angle - dy * k, 0.05, Math.PI - 0.05);
      const axis = new THREE.Vector3().crossVectors(view.up, off).normalize();
      if (axis.lengthSq() > 0) off.applyAxisAngle(axis, next - angle);
      cam.position.copy(view.target).add(off);
      cam.up.copy(view.up);
      cam.lookAt(view.target);
    };
    let hoverPending: THREE.Vector2 | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.id) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        drag.x = e.clientX;
        drag.y = e.clientY;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        if (drag.moved > 4) {
          if (view.autopilot?.kind !== 'in') view.autopilot = null;
          orbit(dx, dy);
        }
        return;
      }
      hoverPending = ndcOf(e);
    };
    const onUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const click = drag.moved <= 4;
      drag = null;
      el.releasePointerCapture(e.pointerId);
      if (!click) return;
      const i = pickAnchor(scene, cam, ndcOf(e), size);
      if (i >= 0) flyInto(i, cam);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      let dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
      if (e.ctrlKey) dy *= 4; // trackpad pinch arrives as ctrl + small deltas
      dy = THREE.MathUtils.clamp(dy, -250, 250);
      const ndc = ndcOf(e);
      const hit = raycastScene(scene, cam, ndc);
      if (hit) view.pivot.copy(hit.point);
      else view.pivot.copy(raycaster.ray.at(cam.position.distanceTo(view.target), new THREE.Vector3()));
      // While a child is in focus and the cursor is on it, keep zooming toward the child itself, even when
      // something else is hit first (the catalytic site is buried inside the protein).
      const w = getWorld();
      const radius = LEVELS[w.level].zoom.focusRadius;
      if (w.focus && radius) {
        const onRay = raycaster.ray.closestPointToPoint(w.focus.center, new THREE.Vector3());
        if (onRay.distanceTo(w.focus.center) < radius) view.pivot.copy(w.focus.center);
      }
      view.pendingZoom += dy * 0.0016;
      view.autopilot = null;
    };
    const tick = () => {
      if (hoverPending && !drag) {
        const i = pickAnchor(scene, cam, hoverPending, size);
        if (i !== getWorld().hover) setWorld({ hover: i });
        el.style.cursor = i >= 0 ? 'pointer' : '';
      }
      hoverPending = null;
      raf = requestAnimationFrame(tick);
    };
    let raf = requestAnimationFrame(tick);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, [gl, scene, cam, size]);

  const viewOffset = useRef(0);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const w = getWorld();
    const L = LEVELS[w.level];
    const z = L.zoom;
    const child = childOf(w.level);
    const C = child ? LEVELS[child] : null;
    const now = performance.now();

    // 1. Autopilot.
    let ap = view.autopilot;
    if (ap?.kind === 'in' && !ap.anchor && !view.switching) {
      if (!child) ap = view.autopilot = { kind: 'settle' };
      else {
        const { index } = nearestIndex(w.level, view.target);
        ap.anchor = reuseOrMake(w.level, index, cam.position);
        setWorld({ focus: ap.anchor });
      }
    }
    if (ap && !view.switching) {
      let aim: THREE.Vector3;
      let goal: number;
      if (ap.kind === 'in' && ap.anchor && C) {
        aim = ap.anchor.center;
        goal = Math.min(C.homeDistance, C.zoom.enterAt! * 0.9) * ap.anchor.scale;
      } else if (ap.kind === 'out') {
        aim = view.target;
        goal = (z.exit ?? L.homeDistance) * 1.25;
      } else {
        aim = new THREE.Vector3(...L.viewCenter);
        goal = L.homeDistance;
      }
      const move = aim.clone().sub(view.target).multiplyScalar(1 - Math.exp(-dt * 3));
      view.target.add(move);
      cam.position.add(move);
      const d = cam.position.distanceTo(view.target);
      const remaining = Math.log(goal / d);
      zoomAbout(cam, view.target, remaining * (1 - Math.exp(-dt * 2.4)));
      if (ap.kind === 'settle' && Math.abs(remaining) < 0.01 && aim.distanceTo(view.target) < d * 0.01) view.autopilot = null;
      cam.up.copy(view.up);
      cam.lookAt(view.target);
    }

    // 2. Wheel zoom, smoothed.
    if (view.pendingZoom !== 0) {
      const step = Math.abs(view.pendingZoom) < 1e-4 ? view.pendingZoom : view.pendingZoom * (1 - Math.exp(-dt * 14));
      view.pendingZoom -= step;
      zoomAbout(cam, view.pivot, step);
      cam.lookAt(view.target);
    }

    let d = cam.position.distanceTo(view.target);

    // 3. Focus: the child nearest the orbit target.
    let focus = w.focus;
    let revealed = w.revealed;
    if (!view.switching && child) {
      if (view.autopilot?.kind === 'in' && view.autopilot.anchor) focus = view.autopilot.anchor;
      else {
        const near = nearestIndex(w.level, view.target);
        const keep = focus && focus.center.distanceTo(view.target) < z.focusRadius! * 1.5;
        if (near.index >= 0 && near.dist < z.focusRadius! && near.index !== focus?.index) {
          focus = reuseOrMake(w.level, near.index, cam.position);
        } else if (!keep) focus = null;
      }
      revealed = !!focus && d / focus.scale < C!.zoom.revealAt!;
      if (focus !== w.focus || revealed !== w.revealed) setWorld({ focus, revealed });
    }

    // 4. Cross into the child, or out to the parent.
    if (!view.switching) {
      if (focus && C && d / focus.scale < C.zoom.enterAt!) {
        view.switching = focus.matrix.clone().invert();
        const next = view.autopilot;
        if (next?.kind === 'in') view.autopilot = child === next.goal ? { kind: 'settle' } : { kind: 'in', anchor: null, goal: next.goal };
        setWorld({ level: child!, entries: { ...w.entries, [child!]: focus }, focus: null, revealed: false, hover: -1 });
      } else if (L.parent && z.exit && d > z.exit) {
        const entry = w.entries[w.level]!;
        view.switching = entry.matrix.clone();
        const next = view.autopilot;
        if (next?.kind === 'out' && next.goal === L.parent) view.autopilot = { kind: 'settle' };
        setWorld({ level: L.parent, focus: entry, revealed: true, hover: -1 });
      }
    }

    // 5. Limits where there is nothing further to zoom into or out to.
    if (!view.switching) {
      if (!focus && d < z.min) {
        zoomAbout(cam, view.target, Math.log(z.min / d));
        view.pendingZoom = Math.max(0, view.pendingZoom);
        view.noticeUntil = now + 2500;
        d = z.min;
      } else if (!L.parent && z.max && d > z.max) {
        zoomAbout(cam, view.target, Math.log(z.max / d));
        view.pendingZoom = Math.min(0, view.pendingZoom);
        d = z.max;
      }
    }

    // 6. Cut a hole into the atom cloud around the catalytic site, so its ball-and-stick view shows.
    if (w.level === 'atp-synthase' && w.focus && w.revealed && C) {
      // Opens over the first quarter of the approach; the camera ends up inside the hole, so nothing blocks the view.
      const t = THREE.MathUtils.smoothstep(C.zoom.revealAt! - d, 0, C.zoom.revealAt! * 0.25);
      pocket.uClipCenter.value.copy(w.focus.center);
      pocket.uClipRadius.value = t * 1.1 * d;
    } else if (w.level === 'catalytic-site') {
      pocket.uClipCenter.value.set(0, 0, 0);
      pocket.uClipRadius.value = THREE.MathUtils.clamp(1.1 * d, 14, 80);
    } else pocket.uClipRadius.value = 0;

    // Clear the packed cytoplasm between the camera and what it is looking at, once the camera is inside the cell.
    nearClip.uClipCenter.value.copy(cam.position);
    if (w.level === 'cell') nearClip.uClipRadius.value = 0.8 * d * (1 - THREE.MathUtils.smoothstep(d, 6, 8));
    else if (w.level === 'mitochondrion') nearClip.uClipRadius.value = 0.8 * d;
    else nearClip.uClipRadius.value = 0;

    // 7. Depth range follows the zoom (with a logarithmic depth buffer, so the ratio can be large).
    cam.near = d * 0.002;
    cam.far = d * 4000;
    const goalOffset = getSim().panelOpen && size.width > 900 ? 190 : 0;
    viewOffset.current += (goalOffset - viewOffset.current) * (1 - Math.exp(-dt * 8));
    cam.setViewOffset(size.width, size.height, Math.round(viewOffset.current), 0, size.width, size.height);
    cam.updateProjectionMatrix();

    // 8. Scale bar, scale ladder, notices.
    const metersPerPixel = ((2 * d * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / size.height) * L.metersPerUnit;
    if (domRefs.scaleBar && domRefs.scaleLabel) {
      const raw = metersPerPixel * 140;
      const exp = Math.floor(Math.log10(raw));
      let length = Math.pow(10, exp);
      for (const n of NICE) if (n * Math.pow(10, exp) <= raw) length = n * Math.pow(10, exp);
      domRefs.scaleBar.style.width = `${Math.round(length / metersPerPixel)}px`;
      domRefs.scaleLabel.textContent = formatLength(length);
    }
    const viewWidth = metersPerPixel * size.width;
    if (domRefs.ladderMarker) domRefs.ladderMarker.style.top = `${(ladderFraction(viewWidth) * 100).toFixed(2)}%`;
    if (domRefs.ladderLabel) domRefs.ladderLabel.textContent = formatLength(viewWidth);
    if (domRefs.notice) domRefs.notice.style.opacity = now < view.noticeUntil ? '1' : '0';
  });

  return null;
}
