// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The feed's name handling: which drone an object belongs to (no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { droneIdOf, dropLink } from "../app/sen/feed.js";

test("drone id from a shared-bus object name", () => {
  assert.equal(droneIdOf("swarm", "drone3"), "3");
  assert.equal(droneIdOf("sim", "truth_drone3"), "3");
  assert.equal(droneIdOf("swarm", "waypoint_navigator_drone7"), "7");
  assert.equal(droneIdOf("swarm", "waypoint_navigator_drone10"), "10");
  assert.equal(droneIdOf("swarm", "ground_station"), "");
});

test("drone<ID> leaving drops its telemetry and the linked flag, keeps the nodes' status", () => {
  const d = { id: "1", truth: {}, linked: true,
              link: { mode: 2, battery: 0.8, navigatorStatus: 1, waypointIndex: 2 } };
  dropLink(d);
  assert.equal(d.linked, false);
  assert.deepEqual(d.link, { navigatorStatus: 1, waypointIndex: 2 });
});
