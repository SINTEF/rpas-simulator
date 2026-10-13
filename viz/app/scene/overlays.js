// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The unit and drone camera presets (view.js flies them), and the label type the overlays on the map
// (airspace names, scene/airspace.js) hand to hud/labels.js.

/** @typedef {import("../model/types.js").Unit} Unit */
/** @typedef {import("./aircraft.js").Drawn} Drawn */
/**
 * A label for hud/labels.js: placed above (sx, sy) by `lift` px with a leader line, or `pin`ned
 * centred on it. opacity < 0.02 = not shown.
 * @typedef {{key: string, cls: string, html: string, prio: number, sx: number, sy: number, px: number,
 *            lift: number, opacity?: number, pin?: boolean}} OverlayLabel
 */

const DRONE_ZOOM = 2.4;          // px per metre of the drone preset: a 10 m aircraft 24 px

/**
 * A unit or drone preset for view.js: "drone:<id>" frames that drone close up, any other unit id
 * ("cluster:1", "vehicle:tank1") its unit. null = not on the map (yet).
 * @param {string} name @param {Unit[]} units @param {Drawn[]} drawn @param {number} vex now
 * @param {(zoom: number) => number} vexFor @param {number} maxZoom
 * @returns {import("./view.js").ViewPose | null}
 */
export function presetPose(name, units, drawn, vex, vexFor, maxZoom) {
  const at = (/** @type {Drawn} */ o, /** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ zoom) =>
    ({ target: /** @type {[number, number, number]} */ ([x, (o.y / vex) * vexFor(zoom), z]), zoom });
  if (name.startsWith("drone:")) { // where it is drawn (followed through the flight)
    const o = drawn.find((d) => d.key === name);
    return o ? at(o, o.x, o.z, DRONE_ZOOM) : null;
  }
  const u = units.find((v) => v.id === name);
  const o = u && drawn.find((d) => d.id === u.members[0].id);
  if (!u || !o) return null;
  // true positions (at this zoom the unit is near true size); the whole unit in ~30 % of the screen
  const xs = u.members.map((m) => m.x), zs = u.members.map((m) => m.z);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), u.extent, 80);
  const zoom = Math.min(maxZoom, (0.3 * Math.min(innerWidth, innerHeight)) / size);
  return at(o, (Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...zs) + Math.min(...zs)) / 2, zoom);
}
