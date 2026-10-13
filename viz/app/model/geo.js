// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Flat-earth metres around the world origin, the same maths as packages/common/geo.h, and DEM
// sampling. Pure: no DOM, no three. Scene axes: x east, y up, z south (z = -north).

const METERS_PER_DEGREE_LATITUDE = 111320;
const DEG = Math.PI / 180;

/** @typedef {{latitude: number, longitude: number}} LatLon */
/** @typedef {{x: number, z: number}} Local  metres east / south of the origin */

/**
 * geo.h geoToNed, as scene coordinates.
 * @param {LatLon} origin @param {number} latitude @param {number} longitude @returns {Local}
 */
export function geoToLocal(origin, latitude, longitude) {
  const north = (latitude - origin.latitude) * METERS_PER_DEGREE_LATITUDE;
  const east = (longitude - origin.longitude) * METERS_PER_DEGREE_LATITUDE * Math.cos(origin.latitude * DEG);
  return { x: east, z: -north };
}

/**
 * geo.h nedToGeo, from scene coordinates.
 * @param {LatLon} origin @param {number} x @param {number} z @returns {LatLon}
 */
export function localToGeo(origin, x, z) {
  const cosLatitude = Math.cos(origin.latitude * DEG);
  return {
    latitude: origin.latitude - z / METERS_PER_DEGREE_LATITUDE,
    longitude: origin.longitude + (cosLatitude > 1e-10 ? x / (METERS_PER_DEGREE_LATITUDE * cosLatitude) : 0),
  };
}

/**
 * A DEM grid in scene metres: sample (row, col) sits at (x0 + col·dx, z0 + row·dz); row 0 = north.
 * @typedef {{x0: number, z0: number, x1: number, z1: number, dx: number, dz: number,
 *            width: number, height: number, data: Int16Array, spacing: number}} Dem
 */

/**
 * One grid of dem.json (bounds are the centres of the edge samples) with its int16 samples.
 * @param {{north: number, south: number, west: number, east: number, width: number, height: number,
 *          spacingM: number}} grid
 * @param {Int16Array} data @param {LatLon} origin @returns {Dem}
 */
export function makeDem(grid, data, origin) {
  const nw = geoToLocal(origin, grid.north, grid.west), se = geoToLocal(origin, grid.south, grid.east);
  return {
    x0: nw.x, z0: nw.z, x1: se.x, z1: se.z,
    dx: (se.x - nw.x) / (grid.width - 1), dz: (se.z - nw.z) / (grid.height - 1),
    width: grid.width, height: grid.height, data, spacing: grid.spacingM,
  };
}

/**
 * Bilinear height in metres AMSL; points outside the grid take the nearest edge sample.
 * @param {Dem} dem @param {number} x @param {number} z @returns {number}
 */
export function demHeight(dem, x, z) {
  const { width: w, height: h, data: g } = dem;
  const c = Math.min(Math.max((x - dem.x0) / dem.dx, 0), w - 1);
  const r = Math.min(Math.max((z - dem.z0) / dem.dz, 0), h - 1);
  const c0 = Math.min(Math.floor(c), w - 2), r0 = Math.min(Math.floor(r), h - 2);
  const fc = c - c0, fr = r - r0, i = r0 * w + c0;
  return (g[i] * (1 - fc) + g[i + 1] * fc) * (1 - fr) + (g[i + w] * (1 - fc) + g[i + w + 1] * fc) * fr;
}

const WATER = 3; // land-cover class (terrain.js)

/** @param {Dem} dem @param {Uint8Array | null} cls @param {number} col @param {number} row */
function waterCell(dem, cls, col, row) {
  const i = Math.min(Math.max(row, 0), dem.height - 1) * dem.width + Math.min(Math.max(col, 0), dem.width - 1);
  return dem.data[i] <= 1 || (!!cls && cls[i] === WATER);
}

/**
 * Water at (x, z): sea (DEM ≤ 1 m) or a lake (land-cover class 3) in the nearest DEM cell.
 * @param {Dem} dem @param {Uint8Array | null} cls land-cover class per DEM sample, or null
 * @param {number} x @param {number} z
 */
export function waterAt(dem, cls, x, z) {
  return waterCell(dem, cls, Math.round((x - dem.x0) / dem.dx), Math.round((z - dem.z0) / dem.dz));
}

/**
 * The nearest land to (x, z): the point itself on land, else the centre of the Euclidean-nearest land
 * cell (rings of DEM cells out to `maxRing`; once one ring has land, the rings out to √2 × its distance
 * are checked for a closer cell). `out` is the caller's cache: while (x, z) stays in the same water
 * cell (and the same land cover) the last answer is returned without a search. Left at (x, z) when no
 * land is within `maxRing` cells.
 * @param {Dem} dem @param {Uint8Array | null} cls land-cover class per DEM sample, or null
 * @param {number} x @param {number} z
 * @param {{x: number, z: number, cell?: number, cls?: Uint8Array | null}} out
 * @param {number} [maxRing] @returns {{x: number, z: number}} out
 */
export function nearestLand(dem, cls, x, z, out, maxRing = 64) {
  const c = Math.round((x - dem.x0) / dem.dx), r = Math.round((z - dem.z0) / dem.dz);
  if (!waterCell(dem, cls, c, r)) { out.x = x; out.z = z; out.cell = -1; return out; }
  const cell = r * dem.width + c;
  if (out.cell === cell && out.cls === cls) return out;
  out.cell = cell;
  out.cls = cls;
  out.x = x;
  out.z = z;
  let best = Infinity, last = maxRing;
  for (let k = 1; k <= last; k++) {
    for (let dr = -k; dr <= k; dr++) {
      const step = Math.abs(dr) === k ? 1 : 2 * k; // the ring only
      for (let dc = -k; dc <= k; dc += step) {
        const d = dr * dr + dc * dc;
        if (d < best && !waterCell(dem, cls, c + dc, r + dr)) {
          best = d;
          out.x = dem.x0 + (c + dc) * dem.dx;
          out.z = dem.z0 + (r + dr) * dem.dz;
        }
      }
    }
    if (best < Infinity) last = Math.min(last, Math.ceil(Math.sqrt(best))); // no closer cell beyond this ring
  }
  return out;
}

/**
 * A body -> NED attitude (w, x, y, z) as the rotation from the model frame (x nose, y up, z right
 * wing) to scene axes (x east, y up, z south); row-major 3 x 3. Scene = A · R · B with A: NED ->
 * scene (x = E, y = -D, z = -N) and B: model -> body FRD (F = x, R = z, D = -y).
 * @param {[number, number, number, number]} q @returns {number[]}
 */
export function attitudeMatrix([w, x, y, z]) {
  const R = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
  const rows = [1, 2, 0], rowSign = [1, -1, -1], cols = [0, 2, 1], colSign = [1, -1, 1];
  const m = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m.push(rowSign[i] * colSign[j] * R[rows[i]][cols[j]]);
  return m;
}
