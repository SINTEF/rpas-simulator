// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { airborne, droneInfo, fleetSections, counts, worst, byId, unitName } from "../app/model/fleet.js";
import { ordinal } from "../app/model/enums.js";

const origin = { latitude: 59.9, longitude: 10.7, altitude: 0 };
const M = 111320;
const HOLD = ordinal("FlightMode", "hold"), DISARMED = ordinal("FlightMode", "disarmed");

/** A drone `north` m north of the origin, flying (hold) or on the ground (disarmed). */
function drone(id, north, { mode = HOLD, battery = 0.9, link = {} } = {}) {
  return { id, truth: { position: { latitude: origin.latitude + north / M, longitude: origin.longitude, altitude: 300 },
                        course: 0, heading: 0, mode, battery }, link: { mode, battery, ...link } };
}

function fleet() {
  const drones = new Map([
    ["1", drone("1", 0)],
    ["2", drone("2", -100)],
    ["3", drone("3", 400)],
    ["10", drone("10", 5000, { battery: 0.1 })],                                     // solo, critical battery
    ["4", drone("4", 6000)],                                                          // solo, fine
    ["5", drone("5", 0, { mode: DISARMED })],                                         // on the ground
    ["6", drone("6", 0, { battery: 0.25 })],                                          // caution battery
  ]);
  return { drones, info: droneInfo(drones) };
}

test("status: from SEN data only", () => {
  const { info } = fleet();
  assert.equal(info.get("2")?.status, "nominal");
  assert.deepEqual(info.get("10"), { status: "critical", reason: "Battery 10 %" });
  assert.equal(info.get("5")?.status, "idle");
});

test("sections: needs attention worst first and nowhere else; airborne and on ground", () => {
  const { drones, info } = fleet();
  const s = fleetSections(drones, info);
  assert.deepEqual(s.attention, ["10", "6"]);
  assert.deepEqual(s.airborne, ["1", "2", "3", "4"]);
  assert.deepEqual(s.ground, ["5"]);
});

test("counts, worst, airborne, id order", () => {
  const { drones, info } = fleet();
  assert.deepEqual(counts(drones, new Map([["tank1", { name: "tank1" }]]), info),
                   { aircraft: 7, airborne: 6, critical: 1, caution: 1, vehicles: 1 });
  assert.equal(worst(["nominal", "caution", "idle"]), "caution");
  assert.equal(worst([]), "idle");
  assert.equal(airborne({ id: "9", truth: {}, link: {} }), false);
  assert.equal(airborne(drone("9", 0, { mode: ordinal("FlightMode", "crashed") })), false); // on the ground
  assert.deepEqual(["10", "2", "1"].sort(byId), ["1", "2", "10"]);
});

test("unitName: drone id, cluster name, vehicle name", () => {
  const u = (/** @type {any} */ kind, /** @type {string} */ name, /** @type {string[]} */ ids) =>
    ({ id: "", kind, name, members: ids.map((id) => ({ id, x: 0, z: 0 })), extent: 0, spacing: 0 });
  const units = [u("lone", "3", ["3"]), u("cluster", "2 drones", ["1", "2"]), u("vehicle", "truck1", ["truck1"])];
  assert.deepEqual(units.map(unitName), ["drone3", "2 drones", "truck1"]);
});
