// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Browser-side derivation: status + reason, units, km from base,
// C2 state. Pure: no DOM, no three. Detach hysteresis lives in scene/minsize.js.

import { geoToLocal } from "./geo.js";
import { ordinal } from "./enums.js";

/** @typedef {import("./types.js").Drone} Drone */
/** @typedef {import("./types.js").GeoPosition} GeoPosition */
/** @typedef {import("./types.js").GroundAsset} GroundAsset */
/** @typedef {import("./types.js").Status} Status */
/** @typedef {import("./types.js").Unit} Unit */
/** @typedef {import("./types.js").UnitMember} UnitMember */

/**
 * The sim clock went backwards: the world restarted (Reset simulation, or up.sh with the page
 * open), so the page memory of the old run (routes, draft, selection) is stale. Unknown times never count.
 * @param {number | undefined} before @param {number | undefined} now  World.simTime, seconds
 */
export function clockWentBack(before, now) {
  return before !== undefined && now !== undefined && now < before - 1;
}

/** Every threshold of the status rule, in one place. */
const THRESHOLDS = {
  batteryCritical: 0.15,
  batteryCaution: 0.3,
};

/**
 * Drones closer than this to one of a cluster's drones join it (parked together;
 * a proximity group: mock-up).
 * Small: the min-size rule scales a cluster as one body, so a far member would push near ones together.
 */
const FRIENDLY_CLUSTER_M = 100;
/** Drones of one cluster are laid out at least this far apart (they may be parked at one spot). */
const MIN_APART_M = 1;

/** Worst first: for sorting "Needs attention". */
export const STATUS_RANK = { critical: 0, caution: 1, nominal: 2, idle: 3 };

const DISARMED = ordinal("FlightMode", "disarmed");
const CRASHED = ordinal("FlightMode", "crashed");

/** Crashed: battery empty in the air, lies on the ground, refuses every command. @param {Drone} d */
export const crashed = (d) => (d.link.mode ?? d.truth.mode) === CRASHED;

/** @param {number} b */
const percent = (b) => `Battery ${Math.round(b * 100)} %`;

/**
 * The status rule (plan §4), worst first; the first match gives status and reason. Judged from what
 * the ground knows (drone<ID> and the navigator, sen/feed.js), battery falling back to truth until telemetry arrives.
 * @type {[Status, (d: Drone, battery: number) => string | false][]}
 */
const RULES = [
  ["critical", (d) => d.alive === false && "Lost"],
  ["critical", (d) => crashed(d) && "Crashed"],
  ["critical", (d, b) => b < THRESHOLDS.batteryCritical && percent(b)],
  ["caution", (d, b) => b < THRESHOLDS.batteryCaution && percent(b)],
];

/**
 * Status and the reason for it ("" when nominal).
 * @param {Drone} d @returns {{status: Status, reason: string}}
 */
export function droneStatus(d) {
  const battery = d.link.battery ?? d.truth.battery ?? 1;
  for (const [status, test] of RULES) {
    const reason = test(d, battery);
    if (reason) return { status, reason };
  }
  const mode = d.link.mode ?? d.truth.mode;
  if (mode === undefined || mode === DISARMED) return { status: "idle", reason: "Disarmed" };
  return { status: "nominal", reason: "" };
}

/**
 * Horizontal distance from the base (World.origin, the spec's fallback for a home position), km.
 * @param {GeoPosition} origin @param {GeoPosition} position @returns {number}
 */
export function kmFromBase(origin, position) {
  const p = geoToLocal(origin, position.latitude, position.longitude);
  return Math.hypot(p.x, p.z) / 1000;
}

/**
 * Largest and smallest distance between any two points (0, 0 for fewer than two).
 * @param {[number, number][]} points
 */
function spread(points) {
  let extent = 0, spacing = Infinity;
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const d = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]);
    extent = Math.max(extent, d);
    spacing = Math.min(spacing, d);
  }
  return { extent, spacing: spacing === Infinity ? 0 : spacing };
}

/**
 * Single-linkage clusters: a member closer than `within` m to one of a cluster's members joins it.
 * Members sorted by id within a cluster, clusters by their first id.
 * @param {UnitMember[]} members @param {number} within @returns {UnitMember[][]}
 */
function cluster(members, within) {
  /** @type {UnitMember[][]} */
  const clusters = [];
  for (const m of [...members].sort((u, v) => (u.id < v.id ? -1 : 1))) {
    const near = clusters.filter((c) => c.some((o) => Math.hypot(o.x - m.x, o.z - m.z) < within));
    const merged = near.flat().concat(m);
    for (const c of near) clusters.splice(clusters.indexOf(c), 1);
    clusters.push(merged.sort((u, v) => (u.id < v.id ? -1 : 1)));
  }
  return clusters.sort((a, b) => (a[0].id < b[0].id ? -1 : 1));
}

/**
 * The units: the drones alone or, parked together, as a cluster (so the min-size rule spreads them
 * side by side), every ground vehicle alone. The clusters are made here, not by SEN: only when
 * `groups` (model/provenance.js "groups"); without, every drone is its own unit.
 * A drone without a truth position is left out.
 * @param {Map<string, Drone>} drones @param {Map<string, GroundAsset>} assets @param {GeoPosition} origin
 * @param {boolean} [groups]
 * @returns {Unit[]}
 */
export function buildUnits(drones, assets, origin, groups = true) {
  /** @param {GeoPosition} p */
  const local = (p) => geoToLocal(origin, p.latitude, p.longitude);
  /** @type {Unit[]} */
  const units = [];
  /** @type {UnitMember[]} */
  const loose = [];
  for (const d of drones.values()) {
    if (!d.truth.position) continue;
    const p = local(d.truth.position);
    loose.push({ id: d.id, x: p.x, z: p.z });
  }
  for (const c of cluster(loose, groups ? FRIENDLY_CLUSTER_M : 0)) {
    if (c.length === 1) {
      units.push({ id: `drone:${c[0].id}`, kind: "lone", name: c[0].id, members: c, extent: 0, spacing: 0 });
      continue;
    }
    // drones at one spot (parked at base) still spread apart: at least MIN_APART_M between any two
    for (const [i, m] of c.entries()) {
      while (c.slice(0, i).some((o) => Math.hypot(o.x - m.x, o.z - m.z) < MIN_APART_M)) m.x += MIN_APART_M;
    }
    units.push({ id: `cluster:${c[0].id}`, kind: "cluster", name: `${c.length} drones`, members: c,
                 ...spread(c.map((m) => /** @type {[number, number]} */ ([m.x, m.z]))) });
  }
  for (const a of [...assets.values()].sort((u, v) => (u.name < v.name ? -1 : 1))) {
    if (!a.position) continue;
    const p = local(a.position);
    units.push({ id: `vehicle:${a.name}`, kind: "vehicle", name: a.name, members: [{ id: a.name, x: p.x, z: p.z }], extent: 0, spacing: 0 });
  }
  return units;
}

/**
 * buildUnits, recomputed only when an input changed (a new 10 Hz sample, a vehicle, the groups layer);
 * every sample is a new position object, so references are enough.
 * @returns {typeof buildUnits}
 */
export function createUnits() {
  /** @type {unknown[]} */
  let last = [];
  /** @type {Unit[]} */
  let units = [];
  return (drones, assets, origin, groups = true) => {
    const key = [origin.latitude, origin.longitude, groups];
    for (const d of drones.values()) key.push(d.id, d.truth.position);
    for (const a of assets.values()) key.push(a.name, a.position);
    if (key.length !== last.length || key.some((v, i) => v !== last[i])) {
      last = key;
      units = buildUnits(drones, assets, origin, groups);
    }
    return units;
  };
}
