// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { droneStatus, buildUnits, kmFromBase, clockWentBack } from "../app/model/derive.js";
import { ordinal } from "../app/model/enums.js";

const M = 111320;

/** A position `north`/`east` metres from p (flat earth around p, as geo.h). */
function offset(p, north, east, up = 0) {
  return { latitude: p.latitude + north / M, longitude: p.longitude + east / (M * Math.cos(p.latitude * Math.PI / 180)),
           altitude: p.altitude + up };
}
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const ARMED = ordinal("FlightMode", "hold");
/** @returns {import("../app/model/types.js").Drone} */
const drone = (link = {}, extra = {}) => ({ id: "1", truth: { battery: 0.9, mode: ARMED }, link: { mode: ARMED, battery: 0.9, ...link }, ...extra });
const statusOf = (link, extra) => droneStatus(drone(link, extra));

test("status rule", () => {
  assert.deepEqual(statusOf(), { status: "nominal", reason: "" });
  assert.deepEqual(statusOf({ mode: ordinal("FlightMode", "disarmed") }), { status: "idle", reason: "Disarmed" });
  assert.equal(droneStatus({ id: "1", truth: {}, link: {} }).status, "idle");
  assert.deepEqual(statusOf({}, { alive: false }), { status: "critical", reason: "Lost" });
  // crashed: critical even with the battery at 0 (the battery rule would say "Battery 0 %")
  assert.deepEqual(statusOf({ mode: ordinal("FlightMode", "crashed"), battery: 0 }), { status: "critical", reason: "Crashed" });
  assert.deepEqual(statusOf({ battery: 0.1 }), { status: "critical", reason: "Battery 10 %" });
  assert.deepEqual(statusOf({ battery: 0.25 }), { status: "caution", reason: "Battery 25 %" });
  // critical wins over caution, and a disarmed drone in trouble is not idle
  assert.equal(statusOf({ battery: 0.1, mode: ordinal("FlightMode", "hold") }).status, "critical");
  assert.equal(statusOf({ mode: ordinal("FlightMode", "disarmed"), battery: 0.1 }).status, "critical");
});

test("units: drones apart alone, every ground vehicle alone, a drone without a position left out", () => {
  const origin = { latitude: 59.9, longitude: 10.7, altitude: 0 };
  const lead = offset(origin, 1000, 0, 300);
  const drones = new Map([
    ["1", { id: "1", truth: { position: lead, course: 0 }, link: {} }],
    ["2", { id: "2", truth: { position: offset(lead, -100, -100) }, link: {} }],
    ["3", { id: "3", truth: { position: offset(lead, -100, 300) }, link: {} }],
    ["4", { id: "4", truth: { position: origin }, link: {} }],
    ["5", { id: "5", truth: {}, link: {} }],
  ]);
  const assets = new Map([
    ["tank1", { name: "tank1", position: offset(origin, 0, 0) }],
    ["truck1", { name: "truck1", position: offset(origin, 0, 5000) }],
    ["tank2", { name: "tank2", position: offset(origin, 0, 500) }],
    ["tank3", { name: "tank3" }],
  ]);
  // four drones 141 m or more apart, each alone
  const units = buildUnits(drones, assets, origin);
  assert.deepEqual(units.map((u) => [u.id, u.kind, u.members.map((m) => m.id)]), [
    ["drone:1", "lone", ["1"]],
    ["drone:2", "lone", ["2"]],
    ["drone:3", "lone", ["3"]],
    ["drone:4", "lone", ["4"]],
    ["vehicle:tank1", "vehicle", ["tank1"]],
    ["vehicle:tank2", "vehicle", ["tank2"]],
    ["vehicle:truck1", "vehicle", ["truck1"]],
  ]);
  assert.deepEqual(units.slice(4).map((u) => u.name), ["tank1", "tank2", "truck1"]);
  near(units[4].extent, 0); near(units[4].spacing, 0);
});

test("units: drones parked together form one cluster; one at one spot is spread 1 m", () => {
  const origin = { latitude: 59.9, longitude: 10.7, altitude: 0 };
  const at = (north, east) => ({ truth: { position: offset(origin, north, east, 100) }, link: {} });
  // 900 m off is not "together": no chain that would scale drones 1 and 2 onto each other
  const drones = new Map([["1", { id: "1", ...at(0, 0) }], ["2", { id: "2", ...at(0, 5) }], ["3", { id: "3", ...at(900, 0) }]]);
  const units = buildUnits(drones, new Map(), origin);
  assert.deepEqual(units.map((u) => [u.id, u.kind, u.members.map((m) => m.id)]),
    [["cluster:1", "cluster", ["1", "2"]], ["drone:3", "lone", ["3"]]]);
  near(units[0].extent, 5, 1e-6); near(units[0].spacing, 5, 1e-6);
  assert.equal(units[0].name, "2 drones");
  const parked = new Map([["1", { id: "1", ...at(0, 0) }], ["2", { id: "2", ...at(0, 0) }], ["4", { id: "4", ...at(0, 0.5) }]]);
  const [c] = buildUnits(parked, new Map(), origin);
  assert.deepEqual(c.members.map((m) => m.id), ["1", "2", "4"]);
  assert.ok(c.spacing >= 1 - 1e-9, `spacing ${c.spacing}`);
});

test("units without groups (mock-up off): no cluster, every drone alone", () => {
  const origin = { latitude: 59.9, longitude: 10.7, altitude: 0 };
  const at = (north, east, alt = 100) => offset(origin, north, east, alt);
  const drones = new Map([
    ["1", { id: "1", truth: { position: at(2000, 0), course: 0 }, link: {} }],
    ["2", { id: "2", truth: { position: at(1900, 0) }, link: {} }],
    ["3", { id: "3", truth: { position: at(0, 0) }, link: {} }], ["4", { id: "4", truth: { position: at(0, 5) }, link: {} }],
  ]);
  const assets = new Map([["tank1", { name: "tank1", position: at(0, 0, 0) }], ["tank2", { name: "tank2", position: at(0, 300, 0) }]]);
  assert.deepEqual(buildUnits(drones, assets, origin, false).map((u) => [u.id, u.kind, u.members.length]), [
    ["drone:1", "lone", 1], ["drone:2", "lone", 1], ["drone:3", "lone", 1], ["drone:4", "lone", 1],
    ["vehicle:tank1", "vehicle", 1], ["vehicle:tank2", "vehicle", 1],
  ]);
});

test("km from base", () => {
  const origin = { latitude: 59.9, longitude: 10.7, altitude: 0 };
  near(kmFromBase(origin, offset(origin, 3000, 4000)), 5, 1e-9);
});

test("clockWentBack: only a clear step back of World.simTime (a restarted world)", () => {
  assert.equal(clockWentBack(undefined, 5), false); // first sample
  assert.equal(clockWentBack(500, undefined), false);
  assert.equal(clockWentBack(500, 501), false);
  assert.equal(clockWentBack(500, 499.5), false); // jitter, not a restart
  assert.equal(clockWentBack(500, 2), true);
});
