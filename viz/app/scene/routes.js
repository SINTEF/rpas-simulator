// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Routes sent from this page (mock-up, model/provenance.js: SEN publishes a drone's route only on its
// drone bus, which the browser cannot read): per drone the numbered waypoints standing on the
// terrain, the planned legs dashed at flight altitude (the flat-sim rule, as the aircraft:
// (groundH + altitude) · vex) with thin drop pins, all in the colour given (the mock-up violet), the
// legs already flown solid and dim, the leg in progress split at the drone. Drawn without depth
// test, so the terrain never hides them. The draft route has its own style (hud/ground.js).
import * as THREE from "three";
import { geoToLocal } from "../model/geo.js";

/** @typedef {import("../model/types.js").GeoPosition} GeoPosition */
/** @typedef {import("./aircraft.js").Drawn} Drawn */
/** @typedef {{waypoints: GeoPosition[], flown: number}} ShownRoute  flown: how many waypoints are reached */

const MAX = 2048;       // vertices per line set
const MARK_PX = 28;     // marker size on screen
const DASH_PX = [9, 6]; // dash, gap on screen

/** @param {THREE.LineBasicMaterial} material */
function lineSet(material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
  const l = new THREE.LineSegments(g, material);
  l.frustumCulled = false;
  l.renderOrder = 9;
  return l;
}

/** A round marker with its number: `colour` while planned, grey once flown. @param {number} n @param {boolean} done @param {string} colour */
function markerTexture(n, done, colour) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
  x.beginPath();
  x.arc(32, 26, 22, 0, 2 * Math.PI);
  x.fillStyle = done ? "#a2a7b0" : colour;
  x.fill();
  x.lineWidth = 4;
  x.strokeStyle = "#fff";
  x.stroke();
  x.beginPath(); // the foot: a short stem down to the ground point
  x.moveTo(32, 48); x.lineTo(32, 64);
  x.strokeStyle = done ? "#a2a7b0" : colour;
  x.stroke();
  x.fillStyle = "#fff";
  x.font = "600 26px Inter, system-ui, sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(String(n), 32, 27);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * @param {THREE.Scene} scene
 * @param {{groundAt: (x: number, z: number) => number, origin: import("../model/geo.js").LatLon, colour: string}} options
 *   groundAt: DEM height (m) at scene x/z; origin: the scene's origin; colour: planned legs and markers
 */
export function createRoutes(scene, { groundAt, origin, colour }) {
  const flat = { depthTest: false, depthWrite: false, transparent: true };
  const dashes = new THREE.LineDashedMaterial({ color: colour, opacity: 0.95, ...flat });
  const planned = lineSet(dashes);
  const flown = lineSet(new THREE.LineBasicMaterial({ color: "#8b919c", opacity: 0.8, ...flat }));
  const pins = lineSet(new THREE.LineBasicMaterial({ color: "#16181d", opacity: 0.3, ...flat }));
  scene.add(planned, flown, pins);
  /** @type {Map<string, THREE.SpriteMaterial>} */
  const materials = new Map();
  /** @type {THREE.Sprite[]} */
  const sprites = [];

  /** @param {number} n @param {boolean} done */
  function material(n, done) {
    const key = `${n}:${done}`;
    let m = materials.get(key);
    if (!m) materials.set(key, (m = new THREE.SpriteMaterial({ map: markerTexture(n, done, colour), ...flat })));
    return m;
  }

  /**
   * One frame.
   * @param {Map<string, ShownRoute>} routes by drone id @param {Drawn[]} drawn aircraft.update()'s
   * @param {GeoPosition | undefined} worldOrigin World.origin @param {THREE.OrthographicCamera} camera @param {number} vex
   */
  function update(routes, drawn, worldOrigin, camera, vex) {
    const w = worldOrigin && geoToLocal(origin, worldOrigin.latitude, worldOrigin.longitude);
    const groundH = w ? groundAt(w.x, w.z) : 0;
    const count = new Map([[planned, 0], [flown, 0], [pins, 0]]);
    /** @param {THREE.LineSegments} set @param {number[]} a @param {number[]} b */
    const segment = (set, a, b) => {
      const n = /** @type {number} */ (count.get(set));
      if (n + 2 > MAX) return;
      const pos = /** @type {THREE.BufferAttribute} */ (set.geometry.attributes.position);
      pos.array.set(a, n * 3);
      pos.array.set(b, n * 3 + 3);
      count.set(set, n + 2);
    };
    let s = 0;
    const px = 1 / camera.zoom;
    for (const [id, r] of routes) {
      const pts = r.waypoints.map((p) => {
        const l = geoToLocal(origin, p.latitude, p.longitude);
        return { air: [l.x, (groundH + p.altitude) * vex, l.z], ground: [l.x, groundAt(l.x, l.z) * vex, l.z] };
      });
      const plane = drawn.find((d) => d.key === `drone:${id}`), at = plane && [plane.x, plane.y, plane.z];
      // the leg in progress runs through the drone: flown behind it, planned ahead
      if (at && r.flown < pts.length) {
        segment(planned, at, pts[r.flown].air);
        if (r.flown > 0) segment(flown, pts[r.flown - 1].air, at);
      }
      for (let i = 1; i < pts.length; i++) {
        if (i < r.flown) segment(flown, pts[i - 1].air, pts[i].air);
        else if (i > r.flown || !at) segment(planned, pts[i - 1].air, pts[i].air);
      }
      pts.forEach((p, i) => {
        segment(pins, p.air, p.ground);
        let sp = sprites[s++];
        if (!sp) {
          sprites.push((sp = new THREE.Sprite()));
          sp.center.set(0.5, 0); // stands on its ground point
          sp.renderOrder = 10;
          scene.add(sp);
        }
        sp.material = material(i + 1, i < r.flown);
        sp.position.set(p.ground[0], p.ground[1], p.ground[2]);
        sp.scale.setScalar(MARK_PX * px);
        sp.visible = true;
      });
    }
    for (let i = s; i < sprites.length; i++) sprites[i].visible = false;
    for (const [set, n] of count) {
      set.geometry.setDrawRange(0, n);
      set.geometry.attributes.position.needsUpdate = true;
    }
    dashes.dashSize = DASH_PX[0] * px;
    dashes.gapSize = DASH_PX[1] * px;
    planned.computeLineDistances();
  }

  return { update };
}
