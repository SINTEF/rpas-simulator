// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The minimum on-screen size rule. Pure: no DOM, no three.
// Every object is drawn at max(true size, ICON px of its kind). Per unit
// s = max(1, (1 − OVERLAP) · ICON / (spacing · pxPerMetre)), capped so the unit is at most MAX_UNIT_PX
// across (never below 1; one object: s = 1); members are displayed at anchor + (p − anchor) · s, so the
// unit grows as one rigid body around its centre just until its closest pair is (1 − OVERLAP) × an
// icon apart: icons may overlap up to OVERLAP. Then units whose
// footprints overlap by more than the same allowance are pushed apart (a few relaxation steps; zero when
// clear). Everything is continuous in pxPerMetre, so zooming never pops, and independent of the camera's
// azimuth, so rotating never moves a unit.

/** @typedef {import("../model/types.js").Unit} Unit */
/** @typedef {{dx: number, dz: number, scale: number}} Display  offset from the true x/z (m), model scale */

/** icon: min px of each object; size: true object length, m. */
export const RULE = {
  lone: { icon: 50, size: 10 },
  cluster: { icon: 50, size: 10 },
  vehicle: { icon: 26, size: 8 },
};
export const OVERLAP = 0.85; // linear: two icons' centres at least (1 − OVERLAP) × an icon apart on screen
const MAX_UNIT_PX = 400;
const RELAX_STEPS = 6;

/** Object px: max(true, ICON). @param {{icon: number, size: number}} r @param {number} ppm */
const objectPx = (r, ppm) => Math.max(r.size * ppm, r.icon);

/**
 * The unit's s. Continuous in pxPerMetre: a max / min of continuous terms.
 * @param {Unit} u @param {{icon: number, size: number}} r @param {number} ppm
 */
function scaleOf(u, r, ppm) {
  if (u.members.length < 2 || u.spacing <= 0) return 1;
  return Math.max(1, Math.min((1 - OVERLAP) * r.icon / (u.spacing * ppm), MAX_UNIT_PX / (u.extent * ppm)));
}

/**
 * Units must not cover each other on screen (a vehicle parked on the drone pair at base) by
 * more than OVERLAP: each unit's footprint, a ground circle round its displayed members plus
 * (1 − OVERLAP) × half an object, is pushed apart from every overlapping one along the line between
 * their true centres, half each way, RELAX_STEPS times; the shift moves every member of the unit. All
 * in the ground frame, so the camera's azimuth changes nothing. Deterministic; continuous (the push is
 * the overlap).
 * @param {Unit[]} units @param {Map<string, Display>} objects
 */
function separate(units, objects) {
  const n = units.length;
  if (n < 2) return;
  const cx = new Float64Array(n), cz = new Float64Array(n), rad = new Float64Array(n), ox = new Float64Array(n), oz = new Float64Array(n);
  const tx = new Float64Array(n), tz = new Float64Array(n); // true centres: the push directions, fixed in zoom
  units.forEach((u, i) => {
    const size = RULE[u.kind].size;
    const pts = u.members.map((m) => {
      const d = /** @type {Display} */ (objects.get(m.id));
      return [m.x + d.dx, m.z + d.dz, ((1 - OVERLAP) * d.scale * size) / 2];
    });
    [tx[i], tz[i]] = centre(u.members);
    cx[i] = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    cz[i] = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    rad[i] = Math.max(...pts.map((p) => Math.hypot(p[0] - cx[i], p[1] - cz[i]) + p[2]));
  });
  for (let step = 0; step < RELAX_STEPS; step++) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      // along the true centres' direction (so it cannot flip while zooming) just far enough to clear
      let ux = tx[j] - tx[i], uz = tz[j] - tz[i];
      const l = Math.hypot(ux, uz);
      if (l < 1e-9) { ux = 1; uz = 0; } else { ux /= l; uz /= l; } // one spot: the later unit to the east
      const dx = cx[j] + ox[j] - cx[i] - ox[i], dz = cz[j] + oz[j] - cz[i] - oz[i], R = rad[i] + rad[j];
      const along = dx * ux + dz * uz, across2 = dx * dx + dz * dz - along * along;
      const push = (Math.sqrt(Math.max(0, R * R - across2)) - along) / 2;
      if (push <= 0) continue;
      ox[i] -= ux * push; oz[i] -= uz * push; ox[j] += ux * push; oz[j] += uz * push;
    }
  }
  units.forEach((u, i) => {
    if (!ox[i] && !oz[i]) return;
    for (const m of u.members) {
      const d = /** @type {Display} */ (objects.get(m.id));
      d.dx += ox[i];
      d.dz += oz[i];
    }
  });
}

/** Mean x/z of the members. @param {{x: number, z: number}[]} ms @returns {[number, number]} */
const centre = (ms) => [ms.reduce((a, m) => a + m.x, 0) / ms.length, ms.reduce((a, m) => a + m.z, 0) / ms.length];

/**
 * The rule. layout() is called once per frame; it does not depend on the camera's azimuth, so
 * rotating the map moves nothing relative to it.
 * @returns {(units: Unit[], pxPerMetre: number, enabled?: boolean) =>
 *   {objects: Map<string, Display>, unitScale: Map<string, number>}}
 */
export function createMinSize() {
  return function layout(units, pxPerMetre, enabled = true) {
    /** @type {Map<string, Display>} */
    const objects = new Map();
    const unitScale = new Map();

    for (const u of units) {
      const r = RULE[u.kind];
      const s = enabled ? scaleOf(u, r, pxPerMetre) : 1;
      unitScale.set(u.id, s);
      const px = objectPx(r, pxPerMetre);
      // a unit grows about its centre, so its true centre stays on the map
      const [ax, az] = centre(u.members);
      for (const m of u.members) {
        if (!enabled) { objects.set(m.id, { dx: 0, dz: 0, scale: 1 }); continue; }
        objects.set(m.id, { dx: (m.x - ax) * (s - 1), dz: (m.z - az) * (s - 1), scale: px / (r.size * pxPerMetre) });
      }
    }
    if (enabled) separate(units, objects);
    return { objects, unitScale };
  };
}
