// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// JSDoc typedefs: the .stl structs the view reads (interfaces/stl/drone_sim/), as they arrive over SEN
// REST/SSE (enums as integers, decoded by enums.js), plus the records derive.js builds from them.
// Types only: nothing is exported at runtime.

/** @typedef {{latitude: number, longitude: number, altitude: number}} GeoPosition  altitude m AMSL */
/** @typedef {[number, number, number]} Vec3  NED */
/** @typedef {[number, number, number, number]} Quaternion  (w, x, y, z), body -> NED */

/**
 * drone_sim.VehicleState (DroneTruth.state, DroneLink.telemetry).
 * @typedef {Object} VehicleState
 * @property {GeoPosition} position
 * @property {Vec3} velocity
 * @property {Quaternion} attitude
 * @property {Vec3} bodyRates
 * @property {number} heading        deg CW from north, nose
 * @property {number} course         deg CW from north, track over ground
 * @property {number} groundSpeed    m/s
 * @property {number} verticalSpeed  m/s, up
 * @property {number} mode           FlightMode
 * @property {number} battery        0..1
 * @property {number} stateTime      sim seconds
 */

/**
 * What the ground knows of a drone (sen/feed.js): swarm.bus/drone<ID> (DroneLink) with `telemetry`
 * spread into it (applyState), plus each node's status under the field the view reads:
 * navigatorStatus / waypointIndex / distanceToNext (waypoint_navigator_drone<ID>.status / currentIndex /
 * distanceToNext). Enums as integers.
 * @typedef {Partial<VehicleState> & {
 *   navigatorStatus?: number, waypointIndex?: number, distanceToNext?: number}} LinkState
 */

/**
 * One drone as the store keeps it: truth_drone<ID>.state spread, and its LinkState (sen/feed.js).
 * @typedef {Object} Drone
 * @property {string} id                  "1" for drone1 / truth_drone1
 * @property {Partial<VehicleState>} truth
 * @property {LinkState} link             DroneLink telemetry + the nodes' status
 * @property {boolean} [linked]           swarm.bus/drone<ID> (the DroneLink) is present: commands can reach it
 * @property {boolean} [alive]            FleetMonitor.drones[].alive; undefined = not listed yet
 */

/**
 * drone_sim.DroneSummary (FleetMonitor.drones).
 * @typedef {{droneId: string, alive: boolean, mode: number, battery: number, timeSinceHeartbeat: number}} DroneSummary
 */

/** @typedef {{zoneName: string, vertices: GeoPosition[]}} NoFlyZone */
/** @typedef {{geocage: GeoPosition[], noFlyZones: NoFlyZone[], minAltitude: number, maxAltitude: number}} Airspace */
/** geocage.Geocage (GeocageService.geocage): altitudes m AMSL. @typedef {{vertices: {latitude: number, longitude: number}[], minAltitude: number, maxAltitude: number}} Geocage */

/**
 * sim.bus/world.
 * @typedef {Object} World
 * @property {GeoPosition} origin         base / flat-earth reference
 * @property {Airspace} [airspace]
 * @property {number} simTime
 * @property {number} timeScale
 * @property {boolean} paused
 */

/**
 * A GroundAsset (tank1, truck1, ...) as the store keeps it.
 * @typedef {Object} GroundAsset
 * @property {string} name
 * @property {number} [assetType]         AssetType
 * @property {GeoPosition} [position]
 * @property {number} [heading]
 */

// --- derived (derive.js, minsize.js) --------------------------------------------------

/** @typedef {"critical" | "caution" | "nominal" | "idle"} Status */

/**
 * A unit member in scene metres (x east, z south, from World.origin).
 * @typedef {Object} UnitMember
 * @property {string} id          drone id or asset name
 * @property {number} x
 * @property {number} z
 */

/**
 * A unit of the min-size rule and of the distance aids.
 * @typedef {Object} Unit
 * @property {string} id                 "drone:<id>", "cluster:<first id>", "vehicle:<asset name>"
 * @property {"lone" | "cluster" | "vehicle"} kind  cluster: drones near each other;
 *                                       vehicle: one ground vehicle
 * @property {string} name               drone id, "<n> drones", or asset name
 * @property {UnitMember[]} members      by id
 * @property {number} extent             m, largest distance between members (D); 0 for one object
 * @property {number} spacing            m, smallest member spacing; 0 for one object
 */

export {};
