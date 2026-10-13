// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { noFlyZones, geocage, radialSpan, insidePolygon, stripLength, stripTicks, stripRows, edgeTab, stackTabs }
  from "../app/model/distance.js";

/** @type {[number, number][]} a 2 km square, 10..12 km east of the base */
const square = [[10000, -1000], [12000, -1000], [12000, 1000], [10000, 1000]];

test("radialSpan: nearest edge and farthest corner; 0 with the base inside", () => {
  const [near, far] = radialSpan(square, [0, 0]);
  assert.equal(near, 10000);
  assert.ok(Math.abs(far - Math.hypot(12000, 1000)) < 1e-9);
  assert.equal(radialSpan(square, [11000, 0])[0], 0);
  assert.ok(insidePolygon([11000, 500], square) && !insidePolygon([9000, 0], square));
});

test("stripLength: the first step with 5 % spare; ticks every tenth, every other labelled", () => {
  assert.deepEqual([0, 4.7, 9.6, 36, 48, 900].map(stripLength), [5, 5, 20, 50, 100, 500]);
  const t = stripTicks(50);
  assert.equal(t.length, 11);
  assert.deepEqual([t[0], t[1], t[10]], [{ km: 0, major: true }, { km: 5, major: false }, { km: 50, major: true }]);
});

test("stripRows: above, then below, then none; in the order given", () => {
  const w = 60;
  assert.deepEqual(stripRows([{ x: 0, width: w }, { x: 30, width: w }, { x: 40, width: w }, { x: 200, width: w }]), [0, 1, -1, 0]);
});

test("edgeTab: null on screen; on the edge towards the point, inset", () => {
  const rect = { l: 0, t: 0, r: 200, b: 100 };
  assert.equal(edgeTab(rect, 50, 50, 8), null);
  const right = /** @type {{x: number, y: number, angle: number}} */ (edgeTab(rect, 1000, 50, 8));
  assert.deepEqual([right.x, right.y, right.angle], [192, 50, 0]);
  const up = /** @type {{x: number, y: number, angle: number}} */ (edgeTab(rect, 100, -500, 8));
  assert.ok(Math.abs(up.x - 100) < 1e-9 && Math.abs(up.y - 8) < 1e-9 && Math.abs(up.angle + Math.PI / 2) < 1e-9);
});

test("stackTabs: inside the rect, overlapping tabs pushed down, separate ones left alone", () => {
  const rect = { l: 0, t: 0, r: 400, b: 300 };
  const p = stackTabs([{ x: 380, y: 100, w: 80, h: 20 }, { x: 380, y: 105, w: 80, h: 20 }, { x: 40, y: 100, w: 60, h: 20 }], rect, 4);
  assert.deepEqual(p, [[320, 90], [320, 114], [10, 90]]);
});

test("stackTabs: stacked upwards at the bottom of the rect", () => {
  const rect = { l: 0, t: 0, r: 400, b: 300 };
  const low = stackTabs([{ x: 380, y: 285, w: 80, h: 20 }, { x: 380, y: 290, w: 80, h: 20 }], rect, 4);
  assert.deepEqual(low, [[320, 275], [320, 251]]);
});

test("noFlyZones: the airspace file's, one per name, degenerate polygons left out", () => {
  const v = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => ({ latitude: i, longitude: n }));
  const z = noFlyZones({ noFlyZones: [{ zoneName: "a", vertices: v(3) }, { zoneName: "b", vertices: v(4) }, { zoneName: "c", vertices: v(2) }] });
  assert.deepEqual([...z.keys()], ["a", "b"]);
  assert.equal(z.get("b")?.length, 4);
  assert.equal(noFlyZones(undefined).size, 0);
});

test("geocage: the service's (live) when it has 3 vertices, else the airspace file's, else none", () => {
  const v = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => ({ latitude: i, longitude: n, altitude: 0 }));
  const file = { geocage: v(4), noFlyZones: [], minAltitude: 0, maxAltitude: 1500 };
  const service = { vertices: v(5), minAltitude: 100, maxAltitude: 900 };
  assert.deepEqual(geocage(service, file), { ...service, live: true });
  assert.deepEqual(geocage({ ...service, vertices: v(2) }, file), { vertices: file.geocage, minAltitude: 0, maxAltitude: 1500, live: false });
  assert.deepEqual(geocage(null, file)?.live, false);
  assert.equal(geocage(null, undefined), null);
});
