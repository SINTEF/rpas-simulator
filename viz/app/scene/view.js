// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Renderer, lights, the orthographic "architect's model" camera with MapControls, the vertical
// exaggeration eased on zoom, and camera presets with an animated camera and the URL hash: #far (the
// theatre), #mid (the base), #near (fixed), and whatever `resolve` knows (a unit id "cluster:1", "drone:3");
// "follow" keeps a unit or drone under the camera.
// Units: metres, x east, y up, z south; camera.zoom is screen px per metre.
import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";

const DISTANCE = 100e3;       // camera stand-off along the view direction (ortho: sets the depth range only)
const DEPTH = 80e3;           // scene depth either side of the target: tight, for depth precision
const MID_ZOOM = 0.095;       // #mid: the base and its surroundings
const FLY_MS = 800;           // preset switch (~0.8 s)
const SETTLE_MS = 400;        // after arrival (or a jump), keep following: the pose comes from last frame's
                              // min-size layout, which only settles once the camera is at the new zoom
const sstep = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Vertical exaggeration: x3 for the whole area, x1.2 close up, eased on log zoom. */
export const vexFor = (/** @type {number} */ zoom) =>
  3 - 1.8 * sstep(Math.log(0.02), Math.log(0.6), Math.log(zoom));

/**
 * A camera pose; azimuth / elevation left out = keep the camera's (a unit or drone preset).
 * @typedef {{target: [number, number, number], zoom: number, azimuth?: number, elevation?: number}} ViewPose
 */

/** @param {number} a @param {number} b @param {number} t */
const mix = (a, b, t) => a + (b - a) * t;

/**
 * The pose at t of a flight A -> B (log zoom). The target moves so that the destination's on-screen
 * offset shrinks monotonically: no fly-off while zooming in (the mockup's lerpView).
 * @param {Required<ViewPose>} A @param {Required<ViewPose>} B @param {number} t 0..1
 * @returns {Required<ViewPose>}
 */
function lerpView(A, B, t) {
  const zoom = Math.exp(mix(Math.log(A.zoom), Math.log(B.zoom), t));
  let k = t;
  if (B.zoom > A.zoom * 1.05) k = (1 - A.zoom / zoom) / (1 - A.zoom / B.zoom);
  else if (B.zoom < A.zoom / 1.05) k = (1 - zoom / A.zoom) / (1 - B.zoom / A.zoom);
  k = Math.min(1, Math.max(0, k));
  const da = ((((B.azimuth - A.azimuth) % 360) + 540) % 360) - 180;
  return { target: /** @type {[number, number, number]} */ (A.target.map((v, i) => mix(v, B.target[i], k))), zoom,
    azimuth: A.azimuth + da * t, elevation: mix(A.elevation, B.elevation, t) };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{x0: number, x1: number, z0: number, z1: number, bottom: number, top: number,
 *          groundAt: (x: number, z: number) => number}} area  slab extent (m) and ground height
 * @param {(name: string) => ViewPose | null} resolve  a preset not fixed here (unit, drone); null = not
 *   (yet) known: the view waits for it, as the first data arrives after the page loads
 * @param {() => {l: number, t: number, r: number, b: number}} free  the map area the panels leave, px:
 *   a resolved preset's target is framed in its middle
 */
export function createView(canvas, area, resolve, free) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0, 0); // the page background shows through
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xa9a59d, 1.1));
  const sun = new THREE.DirectionalLight(0xfff8ee, 2.9);
  sun.position.set(-230, 210, -150); // from the north-west
  scene.add(sun);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, DISTANCE - DEPTH, DISTANCE + DEPTH);
  const controls = new MapControls(camera, canvas);
  Object.assign(controls, {
    enableDamping: true, dampingFactor: 0.14, zoomToCursor: true, screenSpacePanning: false, zoomSpeed: 1.1,
    minPolarAngle: 0.12, maxPolarAngle: 1.25, maxZoom: 3.2,
  });

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    Object.assign(camera, { left: -w / 2, right: w / 2, top: h / 2, bottom: -h / 2 });
    camera.updateProjectionMatrix();
  }
  addEventListener("resize", resize);
  resize();

  /** @param {Required<ViewPose>} p */
  function setView({ target: t, zoom, azimuth, elevation }) {
    const a = (azimuth * Math.PI) / 180, e = (elevation * Math.PI) / 180;
    controls.target.set(t[0], t[1], t[2]);
    camera.position.set(t[0] + Math.sin(a) * Math.cos(e) * DISTANCE, t[1] + Math.sin(e) * DISTANCE,
      t[2] + Math.cos(a) * Math.cos(e) * DISTANCE);
    camera.zoom = zoom;
    camera.lookAt(controls.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  /** @returns {Required<ViewPose>} what the camera shows now */
  function current() {
    const o = camera.position.clone().sub(controls.target);
    return { target: /** @type {[number, number, number]} */ (controls.target.toArray()), zoom: camera.zoom,
      azimuth: (Math.atan2(o.x, o.z) * 180) / Math.PI, elevation: (Math.asin(o.y / o.length()) * 180) / Math.PI };
  }

  // Fixed presets: the whole slab fitted into the space the panels will leave (the theatre); a steep
  // shore on the fjord 12 km south-west of the DEM centre. #mid comes from the base (midPose).
  const azimuth = 45, elevation = 35.264; // true isometric: corner-on, atan(1/√2)
  const at = (/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ zm) =>
    /** @type {[number, number, number]} */ ([x, area.groundAt(x, z) * vexFor(zm), z]);
  /** @type {Record<string, Required<ViewPose>>} */
  const presets = {};
  {
    setView({ target: [0, 0, 0], zoom: 1, azimuth, elevation });
    const pts = [];
    for (const x of [area.x0, area.x1]) for (const z of [area.z0, area.z1])
      for (const y of [area.bottom * 3, area.top * 3]) pts.push(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
    const xs = pts.map((v) => v.x), ys = pts.map((v) => v.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const zoom = Math.min(960 / (x1 - x0), 540 / (y1 - y0));
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const t = new THREE.Vector3().addScaledVector(right, (x0 + x1) / 2).addScaledVector(up, (y0 + y1) / 2 + 85 / zoom);
    presets.far = { target: /** @type {[number, number, number]} */ (t.toArray()), zoom, azimuth, elevation };
    presets.near = { target: at(-6500, 9700, 1.1), zoom: 1.1, azimuth, elevation };
    controls.minZoom = zoom * 0.75;
  }
  /** #mid: the base (World.origin) once it is known, the DEM centre until then. @returns {Required<ViewPose>} */
  const midPose = () => {
    const b = resolve("base"), [x, z] = b ? [b.target[0], b.target[2]] : [0, 0];
    return { target: at(x, z, MID_ZOOM), zoom: MID_ZOOM, azimuth, elevation };
  };
  /** @param {string} name @param {Required<ViewPose>} from @returns {Required<ViewPose> | null} */
  const poseOf = (name, from) => {
    if (presets[name]) return presets[name];
    const p = name === "mid" ? midPose() : resolve(name);
    if (!p) return null;
    const { l, t, r, b } = free(), m = camera.matrixWorld; // the camera's azimuth / elevation, unless p has its own
    const target = new THREE.Vector3(...p.target)
      .addScaledVector(new THREE.Vector3().setFromMatrixColumn(m, 0), (innerWidth - l - r) / 2 / p.zoom)
      .addScaledVector(new THREE.Vector3().setFromMatrixColumn(m, 1), ((t + b) / 2 - innerHeight / 2) / p.zoom);
    return { azimuth: from.azimuth, elevation: from.elevation, ...p,
      target: /** @type {[number, number, number]} */ (target.toArray()) };
  };
  /** @type {{name: string, ms: number} | null} a preset waiting for its data */
  let pending = null;
  /** @type {{name: string, A: Required<ViewPose>, t0: number, ms: number} | null} */
  let flight = null;
  /** @type {{name: string, on: () => boolean, at: THREE.Vector3} | null} the unit or drone followed */
  let follow = null;

  /**
   * Fly to a preset (and name it in the URL hash). A moving unit or drone is followed until arrival.
   * @param {string} name @param {number} [ms] 0 = jump
   */
  function go(name, ms = FLY_MS) {
    if (follow && follow.name !== name) follow = null;
    pending = { name, ms };
    flight = null;
    if (location.hash.slice(1) !== name) history.replaceState(null, "", `#${name}`);
  }
  addEventListener("hashchange", () => go(location.hash.slice(1) || "far"));
  controls.addEventListener("start", () => { pending = flight = null; }); // the user takes over
  /**
   * Move the camera with a unit or drone (a `resolve` name) while `on` holds; null stops. Translate
   * only: zoom and rotation stay the user's; a pan (a left drag, as in MapControls) stops it.
   * @param {string | null} name @param {() => boolean} [on]
   */
  function setFollow(name, on = () => true) {
    const p = name && resolve(name);
    follow = name && p ? { name, on, at: new THREE.Vector3(...p.target) } : null;
  }
  /** @type {[number, number] | null} where a left (pan) drag started */
  let panFrom = null;
  canvas.addEventListener("pointerdown", (e) => {
    panFrom = e.button === 0 && !(e.ctrlKey || e.metaKey || e.shiftKey) ? [e.clientX, e.clientY] : null;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (panFrom && (e.buttons & 1) && Math.hypot(e.clientX - panFrom[0], e.clientY - panFrom[1]) > 4) follow = panFrom = null;
  });
  setView(presets.far);
  go(location.hash.slice(1) || "far", 0);

  /** One frame, before controls.update(): the followed unit or drone, the preset flight. @param {number} now ms */
  function update(now) {
    track();
    if (pending && poseOf(pending.name, current())) {
      flight = { name: pending.name, A: current(), t0: now, ms: pending.ms };
      pending = null;
    }
    if (!flight) return;
    const B = poseOf(flight.name, flight.A);
    const t = flight.ms > 0 ? Math.min(1, (now - flight.t0) / flight.ms) : 1;
    if (!B) { flight = null; return; }
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    setView(lerpView(flight.A, B, e));
    if (now - flight.t0 >= flight.ms + SETTLE_MS) flight = null;
  }

  /** The followed unit or drone's move since the last frame moves the camera. */
  function track() {
    const p = follow && follow.on() ? resolve(follow.name) : null;
    if (!follow || !p) { follow = null; return; }
    const at = new THREE.Vector3(...p.target), d = at.clone().sub(follow.at);
    follow.at = at;
    if (!pending && !flight) { controls.target.add(d); camera.position.add(d); } // a flight is on it already
  }

  return { renderer, scene, camera, controls, go, update, follow: setFollow, following: () => follow && follow.name };
}
