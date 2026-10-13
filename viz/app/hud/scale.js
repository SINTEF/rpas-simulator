// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The model's scale card (top right, as in the mockup): compass, scale bar, model scale and vertical
// exaggeration; the note says whether the minimum on-screen size rule is on (ui/Layers.js).
import * as THREE from "three";
import { RULE, OVERLAP } from "../scene/minsize.js";

/** @typedef {import("../model/store.js").Store} Store */

const PX_PER_M = 96 / 0.0254; // CSS px per metre of paper
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** The largest 1 / 2 / 5 · 10^n not above `m`. */
function niceLength(/** @type {number} */ m) {
  const p = 10 ** Math.floor(Math.log10(m));
  return [5, 2, 1].map((k) => k * p).find((v) => v <= m) || p;
}

const km = (/** @type {number} */ m) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);

/** @param {Store} store */
export function createScale(store) {
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  let shown = "";

  /** @param {THREE.OrthographicCamera} camera @param {THREE.Vector3} target @param {number} vex */
  return function update(camera, target, vex) {
    const ppm = camera.zoom, nice = niceLength(140 / ppm);
    $("scale-bar").style.width = `${(nice * ppm).toFixed(1)}px`;
    $("scale-half").textContent = km(nice / 2).replace(/ .*/, "");
    $("scale-end").textContent = km(nice);
    const n = Math.round(Number((PX_PER_M / ppm).toPrecision(3)));
    const note = `Model 1 : ${n.toLocaleString("en").replace(/,/g, " ")} · vertical ×${vex.toFixed(1)}<br>` +
      (store.minSize ? `Min symbol ${RULE.lone.icon} px · overlap ≤ ${Math.round(OVERLAP * 100)} %` : "True scale");
    if (note !== shown) $("scale-note").innerHTML = shown = note;
    // north (−z) on screen, from the view's target
    a.copy(target).project(camera);
    b.copy(target).setZ(target.z - 1 / ppm).project(camera);
    const angle = Math.atan2(-(b.y - a.y) * innerHeight, (b.x - a.x) * innerWidth) + Math.PI / 2;
    $("compass").style.transform = `rotate(${angle.toFixed(3)}rad)`;
  };
}
