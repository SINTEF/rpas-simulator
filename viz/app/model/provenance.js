// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Mock-up data: what the view shows that the SEN skeleton does not back (yet). One line
// per item: what it is and its future SEN owner (the tooltip of its violet mock style). When SEN
// publishes one, delete its line and read the SEN property instead. The "Mock-up data" layer
// (store.mock) shows or hides all of them. Pure: no DOM, no three.

/** @typedef {import("./types.js").Unit} Unit */

export const MOCK = {
  routes: "Mock-up: the route as sent from this page. SEN: waypoint_navigator_drone<ID>.route on swarm.bus",
  airframe: "Mock-up: hard-coded airframe. SEN: an airframe type on DroneLink",
  airspace: "Mock-up: the simulator's airspace drawing (World.airspace, config/world.yaml: geocage, no-fly zones) until the skeleton's airspace is final; the geocage is SEN data while swarm.bus/geocage runs (GeocageService.geocage)",
  rangeRings: "Mock-up: range rings round the base (view dressing)",
  groups: "Mock-up: proximity groups, made in the browser from the positions. SEN: a group object",
};

/** @typedef {keyof typeof MOCK} MockKey */

/**
 * Whether an item is drawn: SEN data always, mock-up only while the layer is on.
 * @param {{mock: boolean}} store @param {string} key
 */
export const shown = (store, key) => !(key in MOCK) || store.mock;

/** A group (mock-up "groups"): drones near each other. @param {Unit} u */
export const mockGroup = (u) => u.kind === "cluster";
