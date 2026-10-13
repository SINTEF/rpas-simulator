// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMinSize } from "../app/scene/minsize.js";

/** @typedef {import("../app/model/types.js").Unit} Unit */

/** Three drones in a V about (1000, 200/3); D = 200, spacing = 100 (given, not measured). */
/** @returns {Unit[]} */
function units() {
  return [
    { id: "cluster:1", kind: "cluster", name: "3 drones", extent: 200, spacing: 100, members: [
      { id: "1", x: 1000, z: 0 },
      { id: "2", x: 900, z: 100 },
      { id: "3", x: 1100, z: 100 }] },
    { id: "drone:4", kind: "lone", name: "4", extent: 0, spacing: 0, members: [{ id: "4", x: -1e6, z: 0 }] }, // far off: no overlap
  ];
}
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
/** Display equality up to rounding (and -0). */
const same = (o, e) => { for (const k of ["dx", "dz", "scale"]) near(o?.[k] ?? NaN, e?.[k] ?? NaN, 1e-6); };

test("far zoom: the unit grows around its centre just to the overlap allowance, icons 50 px", () => {
  const { objects, unitScale } = createMinSize()(units(), 0.01);
  near(unitScale.get("cluster:1") ?? NaN, 7.5);                 // 0.15 · 50 px / (100 m · 0.01 px/m)
  same(objects.get("1"), { dx: 0, dz: (-200 / 3) * 6.5, scale: 500 }); // 50 px of a 0.1 px aircraft
  near(objects.get("2")?.dx ?? NaN, -100 * 6.5); near(objects.get("2")?.dz ?? NaN, (100 / 3) * 6.5, 1e-6);
  near(objects.get("3")?.scale ?? NaN, 500, 1e-6);
  near(objects.get("4")?.scale ?? NaN, 500);                    // lone: 50 px
});

test("far zoom: neighbours at least 15 % of an icon apart, the unit a tight stack", () => {
  const layout = createMinSize();
  for (let ppm = 0.001; ppm < 20; ppm *= 1.05) {
    const { objects } = layout(units(), ppm);
    const ms = units()[0].members.map((m) => {
      const o = objects.get(m.id);
      return { x: (m.x + (o?.dx ?? NaN)) * ppm, z: (m.z + (o?.dz ?? NaN)) * ppm, px: (o?.scale ?? NaN) * 10 * ppm };
    });
    const d = ms.flatMap((a, i) => ms.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.z - b.z)));
    assert.ok(Math.min(...d) >= 0.15 * ms[0].px - 1e-6, `overlap > 85 % at ${ppm} px/m`);
    if (ppm < 0.05) assert.ok(Math.max(...d) <= 16, `spread ${Math.max(...d)} px at ${ppm} px/m`); // was 70 px
  }
});

test("close up: true scale, the 50 px icon floor independent of spacing", () => {
  const { objects, unitScale } = createMinSize()(units(), 10);
  assert.equal(unitScale.get("cluster:1"), 1);
  same(objects.get("2"), { dx: 0, dz: 0, scale: 1 });  // true 100 px > 50
  const mid = createMinSize()(units(), 0.5).objects;            // s = 1, 50 px floor over a 5 px aircraft
  near(mid.get("2")?.scale ?? NaN, 10, 1e-9);
});

test("continuous in zoom: no pops from theatre to a single aircraft", () => {
  const layout = createMinSize();
  let prev = null;
  for (let ppm = 0.001; ppm < 20; ppm *= 1.002) {
    const { objects } = layout(units(), ppm);
    const now = [...objects.entries()].map(([id, o]) => ({ id, x: o.dx * ppm, z: o.dz * ppm, px: o.scale * 10 * ppm }));
    if (prev) now.forEach((o, i) => {
      const p = prev[i];
      const tol = 0.005 * Math.max(Math.abs(p.x), Math.abs(p.z), p.px) + 1e-9;
      assert.ok(Math.abs(o.x - p.x) <= tol && Math.abs(o.z - p.z) <= tol && Math.abs(o.px - p.px) <= tol,
                `${o.id} jumps at ${ppm} px/m`);
    });
    prev = now;
  }
});

test("switched off: s = 1, true positions and sizes", () => {
  const { objects, unitScale } = createMinSize()(units(), 0.001, false);
  for (const s of unitScale.values()) assert.equal(s, 1);
  for (const o of objects.values()) same(o, { dx: 0, dz: 0, scale: 1 });
});

test("a cluster of two drones 5 m apart: stacked 15 % of an icon apart", () => {
  /** @type {Unit[]} */
  const u = [{ id: "cluster:1", kind: "cluster", name: "2 drones", extent: 5, spacing: 5,
    members: [{ id: "1", x: 0, z: 0 }, { id: "2", x: 5, z: 0 }] }];
  const { objects, unitScale } = createMinSize()(u, 0.01);
  near(unitScale.get("cluster:1") ?? NaN, 150);                // 0.15 · 50 px / (5 m · 0.01 px/m)
  near(objects.get("1")?.dx ?? NaN, -2.5 * 149, 1e-6);         // about the centre: 7.5 px apart on screen
  near(objects.get("2")?.dx ?? NaN, 2.5 * 149, 1e-6);
  near(objects.get("1")?.scale ?? NaN, 500, 1e-6);             // 50 px of a 0.1 px aircraft
  same(createMinSize()(u, 0.01, false).objects.get("2"), { dx: 0, dz: 0, scale: 1 });
});

test("a cluster with a far member spreads its closest pair to the allowance, within 400 px", () => {
  /** @type {Unit[]} */
  const u = [{ id: "cluster:1", kind: "cluster", name: "3 drones", extent: 65, spacing: 5,
    members: [{ id: "1", x: 0, z: 0 }, { id: "2", x: 5, z: 0 }, { id: "3", x: 65, z: 0 }] }];
  const layout = createMinSize();
  const s = (ppm) => layout(u, ppm).unitScale.get("cluster:1") ?? NaN;
  near(s(0.01), 150);                              // the pair 7.5 px apart, the cluster 97.5 px across
  near(s(20), 1);
  // a member 500 m off: capped at 400 px across, the pair 5/500 of it = 4 px apart
  const v = [{ ...u[0], extent: 500, members: [u[0].members[0], u[0].members[1], { id: "3", x: 500, z: 0 }] }];
  near(layout(v, 0.01).unitScale.get("cluster:1") ?? NaN, 80);
  for (let ppm = 0.01; ppm < 20; ppm *= 1.01) assert.ok(Math.abs(s(ppm * 1.01) / s(ppm) - 1) < 0.011); // continuous
});

test("overlapping units are pushed apart on screen, continuously, and not at all when clear", () => {
  /** @type {Unit[]} */
  const u = [
    { id: "cluster:1", kind: "cluster", name: "2 drones", extent: 5, spacing: 5, members: [{ id: "1", x: 0, z: 0 }, { id: "2", x: 5, z: 0 }] },
    { id: "vehicle:tank1", kind: "vehicle", name: "tank1", extent: 0, spacing: 0, members: [{ id: "tank1", x: 100, z: 0 }] },
  ];
  const layout = createMinSize();
  /** screen px between the cluster's and the vehicle's displayed centres, and each unit's px radius */
  const gap = (ppm) => {
    const o = layout(u, ppm).objects, at = (id, x) => (x + (o.get(id)?.dx ?? NaN)) * ppm;
    const c1 = (at("1", 0) + at("2", 5)) / 2, c2 = at("tank1", 100);
    const r1 = Math.abs(at("2", 5) - c1) + (0.15 * (o.get("1")?.scale ?? 0) * 10 * ppm) / 2;
    const r2 = (0.15 * (o.get("tank1")?.scale ?? 0) * 8 * ppm) / 2;
    return Math.abs(c2 - c1) - r1 - r2;
  };
  assert.ok(gap(0.01) >= -1e-6, `theatre zoom: ${gap(0.01)}`);      // footprints overlap no more than 85 %
  const clear = createMinSize()(u, 5).objects;                    // true scale: nothing moves
  same(clear.get("tank1"), { dx: 0, dz: 0, scale: 1 });
  same(clear.get("1"), createMinSize()(u.slice(0, 1), 5).objects.get("1")); // grown, not pushed
  let last = layout(u, 0.01).objects.get("1")?.dx ?? 0;            // continuous in zoom
  for (let ppm = 0.01; ppm < 5; ppm *= 1.01) {
    const dx = layout(u, ppm).objects.get("1")?.dx ?? NaN;
    assert.ok(Math.abs(dx - last) * ppm < 3, `jump at ${ppm}`);
    last = dx;
  }
});

test("rotating the camera moves nothing: the layout is fixed to the map", () => {
  // The same scene seen at several azimuths: laid out in the camera's frame (the map turned by -a),
  // its offsets turned back onto the map must be the same at every azimuth.
  /** @type {Unit[]} */
  const scene = [
    ...units().slice(0, 1),
    { id: "cluster:5", kind: "cluster", name: "2 drones", extent: 5, spacing: 5,
      members: [{ id: "5", x: 1300, z: 400 }, { id: "6", x: 1305, z: 400 }] },
    { id: "vehicle:tank1", kind: "vehicle", name: "tank1", extent: 0, spacing: 0, members: [{ id: "tank1", x: 1200, z: -300 }] },
    { id: "vehicle:tank2", kind: "vehicle", name: "tank2", extent: 0, spacing: 0, members: [{ id: "tank2", x: 1500, z: -200 }] },
  ];
  /** @param {number} deg */
  const at = (deg) => {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const turned = scene.map((u) => ({ ...u, members: u.members.map((m) => ({ ...m, x: c * m.x - s * m.z, z: s * m.x + c * m.z })) }));
    const { objects } = createMinSize()(turned, 0.01);
    return new Map([...objects].map(([id, o]) => [id, { dx: c * o.dx + s * o.dz, dz: -s * o.dx + c * o.dz, scale: o.scale }]));
  };
  const base = at(0);
  assert.ok(Math.hypot(base.get("tank1")?.dx ?? 0, base.get("tank1")?.dz ?? 0) > 1, "the scene overlaps: separation is exercised");
  for (const deg of [45, 90, 170]) for (const [id, o] of at(deg)) same(o, base.get(id));
});
