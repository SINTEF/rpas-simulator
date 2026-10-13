// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The view's state: the last value every SEN object published (the browser holds nothing
// authoritative) and what the user points at. Plain objects: sen/feed.js writes them, the scene
// reads them every frame. Pure: no DOM, no three.

/** @typedef {import("./types.js").Drone} Drone */
/** @typedef {import("./types.js").World} World */
/** @typedef {import("./types.js").GroundAsset} GroundAsset */
/** @typedef {import("./types.js").DroneSummary} DroneSummary */
/** @typedef {import("./types.js").Geocage} Geocage */

/**
 * @typedef {Object} Store
 * @property {boolean} connected
 * @property {Partial<World>} world
 * @property {Map<string, Drone>} drones        by id ("1")
 * @property {Map<string, GroundAsset>} assets  by object name ("tank1")
 * @property {{aliveCount?: number, lostCount?: number, drones?: DroneSummary[]}} fleet  FleetMonitor
 * @property {Geocage | null} geocage          GeocageService.geocage (swarm.bus/geocage, a partner component)
 * @property {string | null} selectedId        drone id
 * @property {string | null} hoverId           "drone:<id>" or "asset:<name>"
 * @property {boolean} minSize                 the minimum on-screen size rule is on (layer "Min size")
 * @property {boolean} airspace                layer "Airspace": geocage, no-fly zones
 * @property {boolean} rangeRings              layer "Range rings"
 * @property {boolean} mock                    layer "Mock-up data" (model/provenance.js); off = the SEN skeleton only
 * @property {(id: string) => Drone} drone     the drone record, created on first use
 * @property {(property: string, value: unknown) => void} setFleet
 */

/** @returns {Store} */
export function createStore() {
  /** @type {Store} */
  const store = {
    connected: false, world: {}, drones: new Map(), assets: new Map(), fleet: {}, geocage: null,
    selectedId: null, hoverId: null, minSize: true, airspace: true, rangeRings: true, mock: false,
    drone(id) {
      let d = store.drones.get(id);
      if (!d) {
        const summary = (store.fleet.drones || []).find((s) => s.droneId === id);
        d = { id, truth: {}, link: {}, alive: summary && summary.alive };
        store.drones.set(id, d);
      }
      return d;
    },
    setFleet(property, value) {
      /** @type {Record<string, unknown>} */ (store.fleet)[property] = value;
      if (property !== "drones") return;
      for (const s of /** @type {DroneSummary[]} */ (value)) {
        const d = store.drones.get(s.droneId);
        if (d) d.alive = s.alive;
      }
    },
  };
  return store;
}
