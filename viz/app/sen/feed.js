// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The SEN feed: one untyped interest per bus, objects dispatched on their SEN class name, every
// property written into the store as published: sim.bus and swarm.bus, opened at start. No drone bus
// (drone<ID>.bus): nothing on it is displayed.
//
// The query strings must stay exactly these (`SELECT * FROM <bus>`): every REST client of the world
// process has to use the same queries, or two interests matching one remote object freeze it (SEN
// kernel bug, ARCHITECTURE §9). This page has its own client id: SEN destroys a session when its id
// re-auths, so sharing an id with another REST client would kill that client's feed.

/** @typedef {import("../model/store.js").Store} Store */

const INTERESTS = {
  sim: "SELECT * FROM sim.bus",
  swarm: "SELECT * FROM swarm.bus",
};

// SEN class name (last dotted segment) -> kind. Anything else on the buses is ignored. A Sim* name
// and its parent mean the same kind (REST reports the nearest class the world process knows).
/** @type {Record<string, string>} */
const KIND_OF = { World: "world", DroneTruth: "truth", GroundAsset: "asset", DroneLink: "link",
                  SimDroneLink: "link", FleetMonitor: "fleet",
                  GeocageService: "geocage",
                  // per-drone nodes on swarm.bus
                  WaypointNavigator: "navigator" };
// The properties read and subscribed per kind. [confirmed] properties arrive only on change, so
// every one is also read once at discovery. Statics (World.origin, World.airspace, GroundAsset.assetType) are read only.
/** @type {Record<string, string[]>} */
const PROPS = {
  world: ["simTime", "timeScale", "paused"],
  truth: ["state"], // drone_sim.VehicleState, one struct: spread by applyState
  link: ["telemetry"],
  fleet: ["aliveCount", "lostCount", "drones"],
  geocage: ["geocage"],
  asset: ["position", "heading"],
};
/**
 * A node's status, written into its drone's `link` record under the field the view reads:
 * kind -> property -> [field, value -> field value]. Enums arrive as their ordinals.
 * @type {Record<string, Record<string, [string, (v: any) => unknown]>>}
 */
const NODE_FIELDS = {
  navigator: { status: ["navigatorStatus", (v) => v], currentIndex: ["waypointIndex", (v) => v],
               distanceToNext: ["distanceToNext", (v) => v] },
};
for (const [kind, fields] of Object.entries(NODE_FIELDS)) PROPS[kind] = Object.keys(fields);
/** The link fields the nodes write; every other link field is the DroneLink's (its telemetry). */
const NODE_FIELD_NAMES = new Set(Object.values(NODE_FIELDS).flatMap((f) => Object.values(f).map(([field]) => field)));

/**
 * swarm.bus/drone<ID> left: the drone is unlinked and its telemetry goes; the nodes' status stays
 * ([confirmed] properties are not re-sent, and the nodes are other objects).
 * @param {import("../model/types.js").Drone} d
 */
export function dropLink(d) {
  d.linked = false;
  for (const k of Object.keys(d.link)) if (!NODE_FIELD_NAMES.has(k)) delete /** @type {Record<string, unknown>} */ (d.link)[k];
}
/** @type {Record<string, string[]>} */
const STATICS = { world: ["origin", "airspace"], asset: ["assetType"] };

/**
 * The drone id an object belongs to: its name ends in drone<ID> (drone3, truth_drone3,
 * waypoint_navigator_drone3).
 * @param {string} interest @param {string} name
 */
export function droneIdOf(interest, name) {
  const m = /drone(\d+)$/.exec(name);
  return m ? m[1] : "";
}

/**
 * A struct property arrives as one object; spread it so callers read plain fields.
 * @param {Record<string, unknown>} target @param {string} property @param {unknown} value
 */
export function applyState(target, property, value) {
  if (property === "state" || property === "telemetry") Object.assign(target, value);
  else target[property] = value;
}

/**
 * Connects and keeps the store fed (it retries forever). Returns the page's one SenClient: commands
 * invoke through it too.
 * @param {Store} store
 */
export function startFeed(store) {
  // @ts-ignore -- sen_client.js is a classic script (index.html loads it): its class is a global
  const client = new SenClient("swarm-ui-" + Math.floor(Math.random() * 1e6));
  /** @type {Map<string, string>} "interest:name" -> kind, for property and removal events */
  const kinds = new Map();
  /** Drone ids whose truth left the buses: a late link or node write must not bring the record back. */
  const gone = new Set();

  /** @param {string} kind @param {string} interest @param {string} name @param {string} property @param {unknown} value */
  function write(kind, interest, name, property, value) {
    const id = droneIdOf(interest, name);
    if (kind === "world") applyState(store.world, property, value);
    else if (kind === "truth") applyState(store.drone(id).truth, property, value);
    else if (kind === "link") {
      if (!gone.has(id)) applyState(store.drone(id).link, property, value);
    } else if (NODE_FIELDS[kind]) {
      const [field, convert] = NODE_FIELDS[kind][property];
      if (!gone.has(id)) /** @type {Record<string, unknown>} */ (store.drone(id).link)[field] = convert(value);
    } else if (kind === "fleet") store.setFleet(property, value);
    else if (kind === "geocage") store.geocage = /** @type {any} */ (value);
    else if (kind === "asset") {
      const a = store.assets.get(name);
      if (a) /** @type {Record<string, unknown>} */ (a)[property] = value;
    }
  }

  client.onConnectionChange = (/** @type {boolean} */ connected) => { store.connected = connected; };

  client.onObjectAdded = async (/** @type {string} */ interest, /** @type {string} */ name, /** @type {string} */ className) => {
    if (!className) { // SSE payloads may omit it; the object definition always has it ("drone_sim.DroneTruth")
      try { className = (await client.get(`/api/interests/${interest}/objects/${name}`)).className; }
      catch (e) { return; }
    }
    const kind = KIND_OF[String(className).split(".").pop() || ""];
    if (!kind) return;
    kinds.set(`${interest}:${name}`, kind);
    if (kind === "asset") store.assets.set(name, { name });
    if (kind === "truth") { gone.delete(droneIdOf(interest, name)); store.drone(droneIdOf(interest, name)); }
    if (kind === "link" && !gone.has(droneIdOf(interest, name))) store.drone(droneIdOf(interest, name)).linked = true;
    for (const p of STATICS[kind] || []) {
      client.getProperty(interest, name, p).then((/** @type {unknown} */ v) => write(kind, interest, name, p, v)).catch(() => {});
    }
    for (const p of PROPS[kind]) {
      client.subscribeProperty(interest, name, p).catch(() => {});
      client.getProperty(interest, name, p).then((/** @type {unknown} */ v) => write(kind, interest, name, p, v)).catch(() => {});
    }
  };

  // An object leaving the interest must leave the screen: the browser keeps nothing alive.
  client.onObjectRemoved = (/** @type {string} */ interest, /** @type {string} */ name) => {
    const kind = kinds.get(`${interest}:${name}`);
    kinds.delete(`${interest}:${name}`);
    const id = droneIdOf(interest, name);
    if (kind === "truth") {
      gone.add(id);
      store.drones.delete(id);
      if (store.selectedId === id) store.selectedId = null;
    } else if (kind === "link") {
      const d = store.drones.get(id);
      if (d) dropLink(d);
      if (d && !d.truth.position) store.drones.delete(id); // a record the link alone kept
    } else if (kind && NODE_FIELDS[kind]) {
      const d = store.drones.get(id);
      for (const [field] of Object.values(NODE_FIELDS[kind])) if (d) delete /** @type {Record<string, unknown>} */ (d.link)[field];
    } else if (kind === "fleet") store.fleet = {};
    else if (kind === "geocage") store.geocage = null;
    else if (kind === "asset") store.assets.delete(name);
  };

  client.onProperty = (/** @type {string} */ interest, /** @type {string} */ name, /** @type {string} */ property, /** @type {unknown} */ value) => {
    const kind = kinds.get(`${interest}:${name}`);
    if (kind) write(kind, interest, name, property, value);
  };

  client.init(INTERESTS).catch((/** @type {unknown} */ e) => console.warn("initial connect failed, retrying", e));
  return client;
}
