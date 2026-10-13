// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Clicks on the ground and the marks they leave. A click (no drag) that picks no aircraft is cast
// onto the terrain tiles with three's raycaster and handed on as latitude / longitude; the second
// click of a double-click is handed on as the double-click itself, never as a click of its own. The draft
// route (numbered points and a line) and the spawns waiting for their drone (a pulsing ring with a
// seconds counter, red when the drone never shows up) are drawn in the #marks SVG over the view.
import * as THREE from "three";
import { pick } from "../scene/aircraft.js";
import { demHeight, geoToLocal, localToGeo } from "../model/geo.js";

/** @typedef {import("../scene/aircraft.js").Drawn} Drawn */
/** @typedef {import("../model/types.js").GeoPosition} GeoPosition */
/** @typedef {import("../ui/App.js").Pending} Pending */

/**
 * @param {{canvas: HTMLCanvasElement, camera: THREE.OrthographicCamera, terrain: THREE.Object3D,
 *          dem: import("../model/geo.js").Dem, origin: import("../model/geo.js").LatLon,
 *          onClick: (latitude: number, longitude: number, shift: boolean, double: boolean) => void}} options
 *   terrain: the group of terrain tiles (and what stands on them)
 */
export function createGround({ canvas, camera, terrain, dem, origin, onClick }) {
  const svg = /** @type {Element} */ (document.getElementById("marks"));
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), v = new THREE.Vector3();
  /** @type {Drawn[]} */
  let drawn = [];
  let shown = "";
  /** @type {[number, number] | null} */
  let downAt = null;

  canvas.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
  // "click", not "pointerup": its detail is the browser's own click count (1, then 2 for a double-click)
  canvas.addEventListener("click", (e) => {
    const still = downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 4;
    if (!still || e.detail > 2 || pick(drawn, e.clientX, e.clientY)) return; // an aircraft: hud/labels.js selects it
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(terrain.children.filter((o) => o.visible && !(/** @type {THREE.InstancedMesh} */ (o).isInstancedMesh)), false)[0]; // not the trees
    if (!hit) return;
    const g = localToGeo(origin, hit.point.x, hit.point.z);
    onClick(g.latitude, g.longitude, e.shiftKey, e.detail === 2);
  });

  /** @param {number} latitude @param {number} longitude @param {number} vex @returns {[string, string]} screen x, y */
  function at(latitude, longitude, vex) {
    const p = geoToLocal(origin, latitude, longitude);
    v.set(p.x, demHeight(dem, p.x, p.z) * vex, p.z).project(camera);
    return [(((v.x + 1) / 2) * innerWidth).toFixed(1), (((1 - v.y) / 2) * innerHeight).toFixed(1)];
  }

  /**
   * One frame.
   * @param {Drawn[]} objects what aircraft.update() drew (clicks on them are not ground clicks)
   * @param {number} vex @param {GeoPosition[]} draft @param {Pending[]} pending @param {number} now ms
   */
  function update(objects, vex, draft, pending, now) {
    drawn = objects;
    const pts = draft.map((w) => at(w.latitude, w.longitude, vex));
    let s = pts.length > 1 ? `<polyline class="draft" points="${pts.map((p) => p.join(",")).join(" ")}"/>` : "";
    pts.forEach(([x, y], i) => { s += `<circle class="wp" cx="${x}" cy="${y}" r="8"/><text class="wpn" x="${x}" y="${y}" dy="3.5">${i + 1}</text>`; });
    for (const p of pending) {
      const [x, y] = at(p.latitude, p.longitude, vex), seconds = Math.round((now - p.t0) / 1000);
      const opacity = p.failed ? 1 : 0.55 + 0.4 * Math.sin((now - p.t0) / 250);
      const text = p.failed ? `drone${p.id ?? ""} not discovered` : `${p.id ? `drone${p.id}` : "new drone"} starting… ${seconds} s`;
      s += `<circle class="spawn${p.failed ? " failed" : ""}" cx="${x}" cy="${y}" r="9" opacity="${opacity.toFixed(2)}"/>` +
        `<text class="spawnt" x="${x}" y="${y}" dy="-16">${text}</text>`;
    }
    if (s !== shown) svg.innerHTML = shown = s;
  }

  return { update };
}
