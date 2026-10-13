// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../app/model/store.js";

const summary = (/** @type {string} */ droneId, /** @type {boolean} */ alive) =>
  ({ droneId, alive, mode: 0, battery: 1, timeSinceHeartbeat: 0 });

test("drone() creates a record once", () => {
  const s = createStore();
  const d = s.drone("1");
  assert.equal(s.drone("1"), d);
  assert.deepEqual([d.truth, d.link, d.alive], [{}, {}, undefined]);
});

test("FleetMonitor.drones sets alive on known drones and on drones created later", () => {
  const s = createStore();
  const d1 = s.drone("1");
  s.setFleet("drones", [summary("1", false), summary("2", true)]);
  assert.equal(d1.alive, false);
  assert.equal(s.drone("2").alive, true);
  s.setFleet("aliveCount", 1);
  assert.equal(s.fleet.aliveCount, 1);
});
