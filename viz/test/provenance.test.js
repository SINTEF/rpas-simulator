// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MOCK, shown, mockGroup } from "../app/model/provenance.js";
import { createStore } from "../app/model/store.js";

test("shown: SEN data always, mock-up only with the layer on", () => {
  for (const key of Object.keys(MOCK)) {
    assert.equal(shown({ mock: false }, key), false, key);
    assert.equal(shown({ mock: true }, key), true, key);
  }
  assert.equal(shown({ mock: false }, "position"), true); // not listed: SEN data
  assert.equal(createStore().mock, false);                 // default: the SEN skeleton only
});

test("every mock-up item says what it is and its future SEN owner", () => {
  assert.deepEqual(Object.keys(MOCK).sort(),
    ["airframe", "airspace", "groups", "rangeRings", "routes"]);
  for (const [key, text] of Object.entries(MOCK)) assert.match(text, /^Mock-up: .{10,}/, key);
});

test("mockGroup: drones near each other, never a lone drone or a vehicle", () => {
  const u = (/** @type {any} */ kind, /** @type {number} */ n) =>
    ({ id: "", kind, name: "", members: Array.from({ length: n }, (_, i) => ({ id: String(i), x: 0, z: 0 })), extent: 0, spacing: 0 });
  assert.deepEqual([u("cluster", 2), u("vehicle", 1), u("lone", 1)].map(mockGroup), [true, false, false]);
});
