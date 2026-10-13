// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// What the fleet panel, the inspector and the top bar show: every drone's status,
// the fleet sections (Needs attention worst first, Airborne, On ground) and the counts. Pure: no DOM, no three.

import { crashed, droneStatus, STATUS_RANK } from "./derive.js";
import { ordinal } from "./enums.js";

/** @typedef {import("./types.js").Drone} Drone */
/** @typedef {import("./types.js").GroundAsset} GroundAsset */
/** @typedef {import("./types.js").Status} Status */
/** @typedef {import("./types.js").Unit} Unit */
/**
 * @typedef {Object} DroneInfo
 * @property {Status} status
 * @property {string} reason        "" when nominal
 */

const ARMED = ordinal("FlightMode", "armed");

/** Drone ids in numeric order ("2" before "10"). @param {string} a @param {string} b */
export const byId = (a, b) => a.localeCompare(b, undefined, { numeric: true });

/** In the air: a flight mode past armed (takeoff, hold, going to, land), not crashed (on the ground). @param {Drone} d */
export function airborne(d) {
  const mode = d.link.mode ?? d.truth.mode;
  return mode !== undefined && mode > ARMED && !crashed(d);
}

/**
 * Status and reason of every drone.
 * @param {Map<string, Drone>} drones
 * @returns {Map<string, DroneInfo>}
 */
export function droneInfo(drones) {
  return new Map([...drones.values()].map((d) => [d.id, droneStatus(d)]));
}

/**
 * What a unit is called on the distance strip and the edge tabs.
 * @param {Unit} u
 */
export function unitName(u) {
  return u.kind === "lone" ? `drone${u.name}` : u.name;
}

/** The worst of some statuses (idle when there are none). @param {Status[]} statuses @returns {Status} */
export function worst(statuses) {
  return statuses.reduce((w, s) => (STATUS_RANK[s] < STATUS_RANK[w] ? s : w), /** @type {Status} */ ("idle"));
}

/**
 * The fleet panel's sections: a drone in trouble is listed under Needs attention only.
 * @param {Map<string, Drone>} drones @param {Map<string, DroneInfo>} info
 * @returns {{attention: string[], airborne: string[], ground: string[]}}
 */
export function fleetSections(drones, info) {
  const ids = [...drones.keys()].sort(byId);
  const rank = (/** @type {string} */ id) => STATUS_RANK[/** @type {DroneInfo} */ (info.get(id)).status];
  const attention = ids.filter((id) => rank(id) < STATUS_RANK.nominal).sort((a, b) => rank(a) - rank(b) || byId(a, b));
  const rest = ids.filter((id) => !attention.includes(id));
  return {
    attention,
    airborne: rest.filter((id) => airborne(/** @type {Drone} */ (drones.get(id)))),
    ground: rest.filter((id) => !airborne(/** @type {Drone} */ (drones.get(id)))),
  };
}

/**
 * The top bar's counts.
 * @param {Map<string, Drone>} drones @param {Map<string, GroundAsset>} assets @param {Map<string, DroneInfo>} info
 */
export function counts(drones, assets, info) {
  const list = [...drones.values()];
  const statuses = [...info.values()].map((i) => i.status);
  return {
    aircraft: list.filter((d) => d.truth.position).length,
    airborne: list.filter(airborne).length,
    critical: statuses.filter((s) => s === "critical").length,
    caution: statuses.filter((s) => s === "caution").length,
    vehicles: assets.size,
  };
}
