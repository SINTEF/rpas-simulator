// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// SEN enums arrive as integers (their ordinal): these tables decode them. Each table lists the .stl
// members in the .stl order (interfaces/stl/drone_sim/; checked by viz/test/enums.test.js); label() turns a member into the word
// the UI shows.

export const ENUMS = Object.freeze({
  FlightMode: ["disarmed", "armed", "takeoff", "hold", "goingTo", "land", "crashed"],      // common/types.stl
  AckStatus: ["accepted", "rejectedInvalid", "rejectedState", "rejectedUnavailable"],         // common/types.stl
  NavigatorStatus: ["idle", "navigating", "arrived"],                                     // common/types.stl
  AssetType: ["tank", "truck"],                                                           // sim_bus/ground_asset.stl
});

/** Members whose UI word differs from the .stl name. */
const WORDS = {
  goingTo: "going to", rejectedInvalid: "rejected (invalid)", rejectedState: "rejected (state)",
  rejectedUnavailable: "rejected (not there)",
};

/**
 * The .stl member name of an ordinal ("" when unknown or not yet read).
 * @param {keyof typeof ENUMS} enumName @param {number | undefined} value @returns {string}
 */
export function member(enumName, value) {
  return (value !== undefined && ENUMS[enumName][value]) || "";
}

/**
 * The UI word for an ordinal.
 * @param {keyof typeof ENUMS} enumName @param {number | undefined} value @returns {string}
 */
export function label(enumName, value) {
  const name = member(enumName, value);
  return WORDS[/** @type {keyof typeof WORDS} */ (name)] || name;
}

/**
 * The ordinal of a member, for comparisons.
 * @param {keyof typeof ENUMS} enumName @param {string} name @returns {number}
 */
export function ordinal(enumName, name) {
  const i = ENUMS[enumName].indexOf(name);
  if (i < 0) throw new Error(`${enumName} has no member ${name}`);
  return i;
}
