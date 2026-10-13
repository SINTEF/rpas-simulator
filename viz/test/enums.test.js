// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The label tables must list each .stl enum's members in the .stl order: SEN sends the ordinal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ENUMS, label, ordinal } from "../app/model/enums.js";

const STL = join(import.meta.dirname, "../../interfaces/stl/drone_sim");

/** Every `enum Name : u8 { a, b, ... }` of one .stl text, comments stripped. @param {string} file */
function fileEnums(file) {
  /** @type {Record<string, string[]>} */
  const found = {};
  const text = readFileSync(file, "utf8").replace(/\/\/.*$/gm, "");
  for (const m of text.matchAll(/enum\s+(\w+)\s*:\s*\w+\s*\{([^}]*)\}/g)) {
    found[m[1]] = m[2].split(",").map((s) => s.trim()).filter(Boolean);
  }
  return found;
}

/** Every enum of the .stl files under dir. @param {string} dir */
function stlEnums(dir) {
  /** @type {Record<string, string[]>} */
  const found = {};
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".stl")) Object.assign(found, fileEnums(join(entry.parentPath, entry.name)));
  }
  return found;
}

test("every table matches its .stl enum, member by member", () => {
  const stl = stlEnums(STL);
  for (const [name, members] of Object.entries(ENUMS)) {
    assert.deepEqual(members, stl[name], name);
  }
});

test("labels and ordinals", () => {
  assert.equal(label("FlightMode", 4), "going to");
  assert.equal(label("FlightMode", undefined), "");
  assert.equal(ordinal("FlightMode", "goingTo"), 4);
  assert.throws(() => ordinal("FlightMode", "goto"));
});
