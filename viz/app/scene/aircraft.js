// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Drones and ground assets in the scene (plan §5): the procedural fixed-wing, tank and truck (models.js)
// (merged per material, inverted-hull outline, slight emissive), status ring, selection ring, flat
// shadow, drop line with a ground tick, trail, and an x-ray pass. Samples (10 Hz) are glided
// between. The flat-sim rule (ARCHITECTURE §7): a drone is drawn at (groundH + altitude) · vex,
// groundH = the DEM under World.origin, so over a hill the sim does not know it may be inside the
// hill; the x-ray pass shows it there at 35 %. A ground asset sits on the DEM. The minimum on-screen
// size rule (minsize.js) moves and scales the display pose; everything round a model follows it.
import * as THREE from "three";
import { attitudeMatrix, geoToLocal } from "../model/geo.js";
import { crashed, droneStatus } from "../model/derive.js";
import { member } from "../model/enums.js";
import { fixedWing, tank, truck, vivid } from "./models.js";

/** @typedef {import("../model/store.js").Store} Store */
/** @typedef {import("../model/types.js").GeoPosition} GeoPosition */
/** @typedef {import("../model/types.js").Status} Status */
/** @typedef {ReturnType<ReturnType<typeof import("./minsize.js").createMinSize>>} Layout */
/**
 * What the HUD and the overlays need of a drawn object: screen position and size (labels, picking),
 * the display pose in the scene (x, y, z m, model scale of the min-size rule).
 * @typedef {{key: string, kind: "drone" | "asset", id: string, sx: number, sy: number, px: number,
 *            x: number, y: number, z: number, scale: number, status?: Status, reason?: string}} Drawn
 */

/** friendly (drones), hostile (ground vehicles: the sim's opposing force), mock (swarm.css --mock) */
export const COLOURS = { friendly: "#1d4dff", hostile: "#ff4d12", mock: "#8e3fd6" };
/** @type {Record<Status, string>} */
const STATUS_COLOURS = { nominal: "#17a553", caution: "#f0a000", critical: "#e3342f", idle: "#9aa0aa" };
const SPAN = 10; const LENGTH = 8;         // m: fixed-wing span (model 3.2 units), vehicle length (model 1.04)
const WING = SPAN / 3.2; const CAR = LENGTH / 1.04;
const OUTLINE_PX = 1.3, TICK_PX = 4;
const AROUND = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);
const LIFT_M = 5, TAKEOFF_M = 8;      // m: clearance over which the lift off the drawn surface blends in; altitude: ground -> flying
/** 0 on the ground … 1 flying: the drawn height, shadow and ground tick blend over the first TAKEOFF_M. */
const flying = (/** @type {number} */ alt) => Math.min(1, Math.max(0, alt / TAKEOFF_M));
const TRAIL = 40, TRAIL_MS = 250;     // trail points per drone, one per 250 ms: 10 s
const MAX = 64;                       // drones with a trail / drop line (buffer size)
const Y = new THREE.Vector3(0, 1, 0), DEG = Math.PI / 180;
const TRUE_SIZE = { dx: 0, dz: 0, scale: 1 };

const GEOMETRY = { drone: fixedWing(), tank: tank(), truck: truck() };
const outlineUniform = { value: 1 }; // metres per screen px
const outline = new THREE.MeshBasicMaterial({ color: "#0e1014", side: THREE.BackSide });
outline.onBeforeCompile = (sh) => {
  sh.uniforms.uMetresPerPx = outlineUniform;
  sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uMetresPerPx;")
    .replace("#include <begin_vertex>",
      "#include <begin_vertex>\ntransformed += normalize(normal) * uMetresPerPx / length(modelMatrix[0].xyz);");
};
const MATERIALS = {
  drone: { body: vivid(COLOURS.friendly, 0.45), accent: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.5, emissive: "#ffffff", emissiveIntensity: 0.15 }) },
  asset: { body: vivid(COLOURS.hostile, 0.3), accent: new THREE.MeshStandardMaterial({ color: "#1b1e24", roughness: 0.7 }) },
};
/** A crashed drone: grey, dull. */
const CRASHED_BODY = new THREE.MeshStandardMaterial({ color: "#6b7079", roughness: 0.9 });
/** Only where something (a hill) hides the model: 35 % of its colour. */
const xray = (/** @type {string} */ c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35,
  depthWrite: false, depthFunc: THREE.GreaterDepth });
const XRAY = { drone: xray(COLOURS.friendly), asset: xray(COLOURS.hostile) };
const shadowMaterial = new THREE.MeshBasicMaterial({ color: "#11141a", transparent: true, opacity: 0.2, depthWrite: false, depthTest: false });
const ringGeometry = (/** @type {number} */ inner) => new THREE.RingGeometry(inner, 1, 72).rotateX(-Math.PI / 2);
// Rings: opaque, no depth test, render order 1: over the terrain (0; a theatre-sized ring cuts into hills), under the models (2)
const flat = (/** @type {string} */ c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, depthWrite: false, depthTest: false });
const RINGS = Object.fromEntries(Object.entries(STATUS_COLOURS).map(([s, c]) => [s, flat(c)]));
const STATUS_RING = ringGeometry(0.86);

/**
 * @param {THREE.Scene} scene
 * @param {{groundAt: (x: number, z: number) => number, surfaceAt: (x: number, z: number) => number,
 *          origin: import("../model/geo.js").LatLon,
 *          toLand: (x: number, z: number, cache: {x: number, z: number}) => {x: number, z: number},
 *          isWater: (x: number, z: number) => boolean}} area
 *   groundAt: DEM height (m) at scene x/z; surfaceAt: the terrain as drawn (terrain.surfaceAt); origin: the scene's origin; toLand: the nearest land point
 *   (geo.nearestLand, `cache` one per object); isWater: water at x/z
 */
export function createAircraft(scene, { groundAt, surfaceAt, origin: sceneOrigin, toLand, isWater }) {
  const toLocal = (/** @type {GeoPosition | import("../model/geo.js").LatLon} */ p) => geoToLocal(sceneOrigin, p.latitude, p.longitude);
  /** @type {Map<string, ReturnType<typeof makeObject>>} */
  const objects = new Map();
  const selected = new THREE.Mesh(ringGeometry(0.94), flat("#16181d"));
  selected.renderOrder = 1;
  scene.add(selected);

  // all drop lines + ground ticks in one draw call, all trails in another
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX * 10 * 3), 3));
  const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ color: "#16181d", transparent: true, opacity: 0.5 }));
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX * TRAIL * 2 * 3), 3));
  trailGeometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX * TRAIL * 2 * 4), 4));
  const trails = new THREE.LineSegments(trailGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
  for (const l of [lines, trails]) { l.frustumCulled = false; scene.add(l); }

  /** @param {"drone" | "asset"} kind @param {string} id @param {keyof typeof GEOMETRY} model */
  function makeObject(kind, id, model) {
    const g = GEOMETRY[model], group = new THREE.Group();
    for (const [geo, mat] of [[g.body, MATERIALS[kind].body], [g.accent, MATERIALS[kind].accent], [g.all, outline], [g.all, XRAY[kind]]]) {
      group.add(Object.assign(new THREE.Mesh(/** @type {THREE.BufferGeometry} */ (geo), /** @type {THREE.Material} */ (mat)), { renderOrder: 2 }));
    }
    const shadow = new THREE.Mesh(g.all, shadowMaterial.clone()); // own opacity: fades in at takeoff
    const ring = new THREE.Mesh(STATUS_RING, RINGS.nominal);
    shadow.renderOrder = ring.renderOrder = 1;
    ring.visible = kind === "drone";
    scene.add(group, shadow, ring);
    // glide state: pos = (x, altitude, z) true metres, quat = model -> scene
    const o = { kind, id, model, group, shadow, ring, sample: /** @type {unknown} */ (null), pos: new THREE.Vector3(), quat: new THREE.Quaternion(),
      from: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }, to: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
      t0: 0, tSample: -1, interval: 100, trail: /** @type {number[][]} */ ([]), lastTrail: 0, land: { x: 0, z: 0 },
      /** @type {Drawn} */ drawn: { key: `${kind}:${id}`, kind, id, sx: 0, sy: 0, px: 0, x: 0, y: 0, z: 0, scale: 1 } };
    return o;
  }

  /** Starts a glide from what is on screen to the new sample, lasting one measured sample interval. */
  function glideTo(/** @type {ReturnType<typeof makeObject>} */ o, /** @type {THREE.Vector3} */ pos, /** @type {THREE.Quaternion} */ quat, /** @type {number} */ now) {
    if (o.tSample < 0) { o.pos.copy(pos); o.quat.copy(quat); }
    else o.interval = Math.min(500, Math.max(30, 0.7 * o.interval + 0.3 * (now - o.tSample)));
    o.tSample = o.t0 = now;
    o.from.pos.copy(o.pos); o.from.quat.copy(o.quat);
    o.to.pos.copy(pos); o.to.quat.copy(quat);
  }

  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v = new THREE.Vector3();
  const friendly = new THREE.Color(COLOURS.friendly);
  /** The highest drawn surface (m) under a disc of radius r: its centre, and 8 points at r / 2 and r. */
  const topUnder = (/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ r) => {
    let h = surfaceAt(x, z);
    for (const [a, b] of AROUND) h = Math.max(h, surfaceAt(x + a * r, z + b * r), surfaceAt(x + a * r * 0.5, z + b * r * 0.5));
    return h;
  };

  /**
   * One frame: follow the store, glide, place everything, project for the HUD.
   * @param {Store} store @param {THREE.OrthographicCamera} camera @param {number} vex @param {number} now ms
   * @param {Layout} layout the min-size rule's for this frame's units
   * @returns {Drawn[]} what is drawn, with screen position and size
   */
  function update(store, camera, vex, now, layout) {
    const origin = store.world.origin;
    const groundH = origin ? groundAt(toLocal(origin).x, toLocal(origin).z) : 0;
    const ppm = camera.zoom;
    const display = layout.objects;
    outlineUniform.value = OUTLINE_PX / ppm;
    const seen = new Set();
    /** @type {Drawn[]} */
    const drawn = [];
    let nLine = 0, nTrail = 0;
    const linePos = /** @type {Float32Array} */ (lineGeometry.attributes.position.array);
    const trailPos = /** @type {Float32Array} */ (trailGeometry.attributes.position.array);
    const trailCol = /** @type {Float32Array} */ (trailGeometry.attributes.color.array);
    const segment = (/** @type {number[]} */ a, /** @type {number[]} */ b) => {
      if (nLine < MAX * 10) { linePos.set(a, nLine * 3); linePos.set(b, nLine * 3 + 3); nLine += 2; }
    };

    /**
     * @param {"drone" | "asset"} kind @param {string} id @param {GeoPosition} position
     * @param {keyof typeof GEOMETRY} model rebuilt when it changes (assetType may arrive after the position)
     */
    function track(kind, id, position, /** @type {() => THREE.Quaternion} */ attitude, model) {
      const key = `${kind}:${id}`;
      seen.add(key);
      let o = objects.get(key);
      if (o && o.model !== model) scene.remove(o.group, o.shadow, o.ring);
      if (!o || o.model !== model) objects.set(key, (o = makeObject(kind, id, model)));
      // step the glide to now first: a new sample then starts from where the old glide is now, which
      // keeps things moving even when frames are slower than the samples
      const a = Math.min(1, (now - o.t0) / o.interval);
      o.pos.lerpVectors(o.from.pos, o.to.pos, a);
      o.quat.slerpQuaternions(o.from.quat, o.to.quat, a);
      if (position !== o.sample) { // every sample is a new object (applyState)
        o.sample = position;
        const l = toLocal(position);
        glideTo(o, _p.set(l.x, position.altitude || 0, l.z), attitude(), now);
      }
      return o;
    }

    for (const d of store.drones.values()) {
      const s = d.truth;
      if (!s.position) continue;
      const q = s.attitude;
      const o = track("drone", d.id, s.position, () => {
        if (!q) return _q.identity();
        const m = attitudeMatrix(q);
        return _q.setFromRotationMatrix(_m.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1));
      }, "drone");
      const { dx, dz, scale } = display.get(d.id) || TRUE_SIZE;
      const x = o.pos.x + dx, z = o.pos.z + dz, gy = surfaceAt(x, z) * vex, w = flying(o.pos.y);
      // Truth first (flat-sim rule): drawn at groundH + altitude. A drone truly above the DEM keeps its
      // clearance over the surface as drawn under its displayed ring (the min-size spread and scale, a
      // coarse tile), blended in over its first LIFT_M of clearance; one truly inside a hill stays there
      // (x-ray). On the ground: a ground thing, on the drawn surface under it, wheels down. In between
      // (the first TAKEOFF_M of altitude) the two heights blend, so takeoff and landing do not jump.
      const top = topUnder(x, z, SPAN * 0.62 * scale), onGround = top * vex + 0.35 * WING * scale;
      const trueY = groundH + o.pos.y, clearance = trueY - groundAt(o.pos.x, o.pos.z);
      const lift = Math.min(1, Math.max(0, clearance / LIFT_M)) * Math.max(0, top - (trueY - clearance)) * vex;
      const drawY = (/** @type {number} */ alt) => onGround + ((groundH + alt) * vex + lift - onGround) * flying(alt);
      const y = drawY(o.pos.y);
      o.group.position.set(x, y, z);
      o.group.quaternion.copy(o.quat);
      o.group.scale.setScalar(WING * scale);
      const wreck = crashed(d);
      /** @type {THREE.Mesh} */ (o.group.children[0]).material = wreck ? CRASHED_BODY : MATERIALS.drone.body;
      const { status, reason } = droneStatus(d);
      o.ring.material = RINGS[status];
      o.ring.position.set(x, y - 0.05, z);
      o.ring.scale.setScalar(SPAN * 0.62 * scale);
      o.shadow.visible = w > 0;
      o.shadow.material.opacity = 0.2 * w;
      o.shadow.position.set(x, gy + 0.3, z);
      const nose = _v.set(1, 0, 0).applyQuaternion(o.quat);
      o.shadow.quaternion.setFromAxisAngle(Y, Math.atan2(-nose.z, nose.x)); // the heading only
      o.shadow.scale.set(WING * scale, 0.001, WING * scale);
      if (d.id === store.selectedId) { selected.position.copy(o.ring.position); selected.scale.setScalar(SPAN * 0.8 * scale); }
      if (w > 0) { // the drop line grows out of the model, the tick with it
        const t = (w * TICK_PX) / ppm;
        segment([x, y, z], [x, gy, z]);
        for (const [a, b] of [[[t, 0], [0, t]], [[0, t], [-t, 0]], [[-t, 0], [0, -t]], [[0, -t], [t, 0]]]) {
          segment([x + a[0], gy, z + a[1]], [x + b[0], gy, z + b[1]]);
        }
      }
      if (wreck) o.trail.length = 0; // no trail: it lies still
      const last = o.trail[o.trail.length - 1];
      if (!wreck && now - o.lastTrail > TRAIL_MS && (!last || Math.hypot(o.pos.x - last[0], o.pos.y - last[1], o.pos.z - last[2]) > 1)) {
        o.lastTrail = now;
        o.trail.push([o.pos.x, o.pos.y, o.pos.z, now]); // true positions, drawn shifted with the display pose
      }
      while (o.trail.length > TRAIL || (o.trail.length && now - o.trail[0][3] > TRAIL * TRAIL_MS)) o.trail.shift();
      for (let i = 1; i < o.trail.length && nTrail < MAX * TRAIL * 2; i++) {
        for (const k of [i - 1, i]) {
          const p = o.trail[k];
          trailPos.set([p[0] + dx, drawY(p[1]), p[2] + dz], nTrail * 3);
          trailCol.set([friendly.r, friendly.g, friendly.b, (0.6 * k) / o.trail.length], nTrail * 4);
          nTrail++;
        }
      }
      o.drawn.status = status;
      o.drawn.reason = reason;
      drawn.push(project(o, x, y, z, scale, SPAN * scale * ppm, camera));
    }

    for (const a of store.assets.values()) {
      if (!a.position) continue;
      const heading = a.heading || 0;
      const o = track("asset", a.name, a.position, () => _q.setFromAxisAngle(Y, (90 - heading) * DEG),
        member("AssetType", a.assetType) === "tank" ? "tank" : "truck");
      const { dx, dz, scale } = display.get(a.name) || TRUE_SIZE;
      // the min-size spread must not park a vehicle in the fjord: a vehicle on land is displayed on land
      let x = o.pos.x + dx, z = o.pos.z + dz;
      if ((dx || dz) && !isWater(o.pos.x, o.pos.z)) ({ x, z } = toLand(x, z, o.land));
      const y = surfaceAt(x, z) * vex;
      o.group.position.set(x, y, z);
      o.group.quaternion.copy(o.quat);
      o.group.scale.setScalar(CAR * scale);
      o.shadow.position.set(x + 0.12 * CAR * scale, y + 0.3, z + 0.12 * CAR * scale);
      o.shadow.quaternion.copy(o.quat);
      o.shadow.scale.set(CAR * scale, 0.001, CAR * scale);
      drawn.push(project(o, x, y, z, scale, LENGTH * scale * ppm, camera));
    }

    selected.visible = !!store.selectedId && objects.has(`drone:${store.selectedId}`);
    for (const [key, o] of objects) {
      if (seen.has(key)) continue;
      scene.remove(o.group, o.shadow, o.ring);
      objects.delete(key);
    }
    lineGeometry.setDrawRange(0, nLine);
    lineGeometry.attributes.position.needsUpdate = true;
    trailGeometry.setDrawRange(0, nTrail);
    trailGeometry.attributes.position.needsUpdate = trailGeometry.attributes.color.needsUpdate = true;
    return drawn;
  }

  /** Screen position (CSS px) and on-screen size of an object. */
  function project(/** @type {ReturnType<typeof makeObject>} */ o, /** @type {number} */ x, /** @type {number} */ y,
    /** @type {number} */ z, /** @type {number} */ scale, /** @type {number} */ px, /** @type {THREE.OrthographicCamera} */ camera) {
    _v.set(x, y, z).project(camera);
    Object.assign(o.drawn, { sx: ((_v.x + 1) / 2) * innerWidth, sy: ((1 - _v.y) / 2) * innerHeight, px, x, y, z, scale });
    return o.drawn;
  }

  return { update };
}

/**
 * The drawn object under a screen point: the nearest within its size (at least 14 px).
 * @param {Drawn[]} drawn @param {number} x @param {number} y @returns {Drawn | null}
 */
export function pick(drawn, x, y) {
  let best = null, bestD = Infinity;
  for (const o of drawn) {
    const d = Math.hypot(x - o.sx, y - o.sy);
    if (d < Math.max(14, o.px * 0.6) && d < bestD) { best = o; bestD = d; }
  }
  return best;
}
