// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { geoToLocal, localToGeo, makeDem, demHeight, nearestLand, waterAt, attitudeMatrix } from "../app/model/geo.js";

const origin = { latitude: 59.9139, longitude: 10.7522 };

test("0.001 deg north is 111.32 m of -z; east shrinks by cos(latitude)", () => {
  const p = geoToLocal(origin, origin.latitude + 0.001, origin.longitude + 0.001);
  assert.ok(Math.abs(p.z + 111.32) < 1e-6);
  assert.ok(Math.abs(p.x - 111.32 * Math.cos(origin.latitude * Math.PI / 180)) < 1e-6);
});

test("localToGeo inverts geoToLocal", () => {
  const p = geoToLocal(origin, 59.95, 10.6);
  const g = localToGeo(origin, p.x, p.z);
  assert.ok(Math.abs(g.latitude - 59.95) < 1e-9 && Math.abs(g.longitude - 10.6) < 1e-9);
});

test("demHeight: samples, bilinear midpoint, clamped outside", () => {
  // 2 x 2 grid, row 0 north: [10 20; 30 40]
  const dem = makeDem({ north: 59.92, south: 59.91, west: 10.75, east: 10.76, width: 2, height: 2, spacingM: 1 },
    Int16Array.from([10, 20, 30, 40]), origin);
  assert.equal(demHeight(dem, dem.x0, dem.z0), 10);
  assert.equal(demHeight(dem, dem.x1, dem.z1), 40);
  assert.equal(demHeight(dem, (dem.x0 + dem.x1) / 2, (dem.z0 + dem.z1) / 2), 25);
  assert.equal(demHeight(dem, dem.x1 + 1e4, dem.z0 - 1e4), 20);
});

test("nearestLand: on land unchanged; from sea or lake to the nearest land cell", () => {
  // 5 x 5 grid, 1 cell = dx m; sea (0 m) except land in column 4; a lake (class 3) at row 0 column 4
  const data = new Int16Array(25), cls = new Uint8Array(25);
  for (let r = 0; r < 5; r++) data[r * 5 + 4] = 50;
  cls[4] = 3;
  const dem = makeDem({ north: 59.92, south: 59.91, west: 10.75, east: 10.76, width: 5, height: 5, spacingM: 1 }, data, origin);
  const out = { x: 0, z: 0 };
  const cell = (/** @type {number} */ c, /** @type {number} */ r) => [dem.x0 + c * dem.dx, dem.z0 + r * dem.dz];
  const [lx, lz] = cell(4, 2);
  nearestLand(dem, cls, lx + 1, lz, out);
  assert.deepEqual([out.x, out.z], [lx + 1, lz]);                       // on land: itself
  nearestLand(dem, cls, ...cell(2, 2), out);
  assert.deepEqual([out.x, out.z], cell(4, 2));                          // two cells east
  nearestLand(dem, cls, ...cell(4, 0), out);
  assert.deepEqual([out.x, out.z], cell(4, 1));                          // off the lake, one south
  nearestLand(dem, null, ...cell(4, 0), out);
  assert.deepEqual([out.x, out.z], cell(4, 0));                          // no land cover: the DEM alone
  nearestLand(dem, cls, ...cell(0, 2), out, 1);
  assert.deepEqual([out.x, out.z], cell(0, 2));                          // none within the rings: unchanged
  assert.equal(waterAt(dem, cls, ...cell(4, 0)), true);
  assert.equal(waterAt(dem, cls, ...cell(4, 1)), false);
});

test("nearestLand: Euclidean nearest beyond the first ring with land; cached per water cell", () => {
  // 9 x 9 sea; land at (7, 7) (ring 3 corner, d² 18) and (8, 4) (ring 4 edge, d² 16) from (4, 4)
  const data = new Int16Array(81);
  data[7 * 9 + 7] = 10;
  data[4 * 9 + 8] = 10;
  const dem = makeDem({ north: 59.92, south: 59.91, west: 10.75, east: 10.76, width: 9, height: 9, spacingM: 1 }, data, origin);
  const cell = (/** @type {number} */ c, /** @type {number} */ r) => [dem.x0 + c * dem.dx, dem.z0 + r * dem.dz];
  const out = { x: 0, z: 0 };
  const [x, z] = cell(4, 4);
  nearestLand(dem, null, x, z, out);
  assert.deepEqual([out.x, out.z], cell(8, 4));
  data[4 * 9 + 8] = 0;                                         // not searched again inside the same cell
  nearestLand(dem, null, x + dem.dx * 0.2, z, out);
  assert.deepEqual([out.x, out.z], cell(8, 4));
});

test("attitudeMatrix: level north, heading east, right bank", () => {
  const nose = (/** @type {number[]} */ m) => [m[0], m[3], m[6]], wing = (/** @type {number[]} */ m) => [m[2], m[5], m[8]];
  const near = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  assert.ok(near(nose(attitudeMatrix([1, 0, 0, 0])), [0, 0, -1]));          // north = -z
  assert.ok(near(wing(attitudeMatrix([1, 0, 0, 0])), [1, 0, 0]));           // right wing east
  const c = Math.SQRT1_2;
  assert.ok(near(nose(attitudeMatrix([c, 0, 0, c])), [1, 0, 0]));           // yaw 90: nose east
  assert.ok(near(wing(attitudeMatrix([c, c, 0, 0])), [0, -1, 0]));          // roll 90 right: right wing down
});
