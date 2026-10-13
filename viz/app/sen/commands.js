// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The command layer: every drone command of the view is a call on the drone's own object on swarm.bus,
// drone<ID> or waypoint_navigator_drone<ID>, which answers with its ack (ARCHITECTURE.md §3.2). Simulator
// control stays direct: the clock through sim.bus/world, spawn / remove through serve.py.
// Commands return their results; one injected toast sink reports them. A command to several drones
// is a fan-out of per-drone invokes with one aggregated toast. The draft route is UI state: a plain
// GeoPosition array the caller owns and passes in.

import { member } from "../model/enums.js";
import { crashed } from "../model/derive.js";

/** @typedef {import("../model/types.js").Drone} Drone */
/** @typedef {import("../model/types.js").GeoPosition} GeoPosition */
/** @typedef {(text: string, bad: boolean) => void} ToastSink */
/**
 * One invoke's outcome. status: the AckStatus member, or "error" when the invoke itself failed.
 * @typedef {{target: string, ok: boolean, status: string, message: string}} Result
 */
/**
 * The parts of SenClient used here (sen_client.js), so a fake can stand in.
 * @typedef {{invoke: (interest: string, object: string, method: string, args: unknown[]) => Promise<{id: unknown}>,
 *            get: (href: string) => Promise<any>}} Client
 */

export const TAKEOFF_ALT = 120;              // m AGL: one fixed value, the UI has no altitude box

/**
 * Whether a command is enabled for a drone (dimmed otherwise), by these rules: drone commands need a selected drone, route commands a draft. Invokes also need the
 * drone on swarm.bus (drone.linked: its drone<ID> is present). A crashed drone refuses everything: only remove.
 * @param {string} command @param {Drone | null | undefined} drone @param {number} [draftLength]
 * @returns {boolean}
 */
export function applicable(command, drone, draftLength = 0) {
  if (drone && crashed(drone) && command === "addWaypoint") return false;
  const linked = !!drone && !!drone.linked && !crashed(drone);
  switch (command) {
    case "spawn": return true;
    case "clearRoute": return draftLength > 0;
    case "remove": case "addWaypoint": return !!drone;
    case "sendRoute": return linked && draftLength > 0;
    case "arm": case "takeoff": case "land": case "disarm":
    case "goTo": return linked;
    default: throw new Error(`unknown command ${command}`);
  }
}

/**
 * A draft waypoint at a clicked ground point: the drone's current altitude, but never below the
 * takeoff altitude over the flat sim ground (World.origin), so a route drafted on the ground is flown
 * at TAKEOFF_ALT.
 * @param {number} latitude @param {number} longitude @param {Drone | undefined} drone
 * @param {number} groundAltitude  World.origin.altitude
 * @returns {GeoPosition}
 */
export function waypointAt(latitude, longitude, drone, groundAltitude) {
  const current = (drone && drone.truth.position && drone.truth.position.altitude) || 0;
  return { latitude, longitude, altitude: Math.max(current, groundAltitude + TAKEOFF_ALT) };
}

/**
 * One toast line for a fan-out: the ack itself for one target, else a count and every failure.
 * @param {string} what @param {Result[]} results @returns {{text: string, bad: boolean}}
 */
function summarize(what, results) {
  const failed = results.filter((r) => !r.ok);
  if (results.length === 1) {
    const r = results[0];
    return { text: `${r.target}.${what}${r.status === "error" ? " failed" : ""}: ${r.message}`, bad: !r.ok };
  }
  const text = `${what} ×${results.length}: ${results.length - failed.length} accepted` +
    failed.map((r) => `, ${r.target} ${r.status === "error" ? "failed" : r.status}: ${r.message}`).join("");
  return { text, bad: failed.length > 0 };
}

/** A tiny DOM toast sink: one line per toast in `container`, gone after 5 s. @param {HTMLElement} container @returns {ToastSink} */
export function domToast(container) {
  return (text, bad) => {
    const el = document.createElement("div");
    el.className = "toast" + (bad ? " bad" : "");
    el.textContent = text;
    container.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  };
}

/** @param {string | string[]} ids @returns {string[]} */
const list = (ids) => (Array.isArray(ids) ? ids : [ids]);

/**
 * @param {{client: Client, toast?: ToastSink, fetch?: typeof fetch, pollMs?: number}} options
 *   fetch posts /spawn and /kill (serve.py); pollMs is the ack poll period (25 polls, then a timeout)
 */
export function createCommands({ client, toast = () => {}, fetch = globalThis.fetch, pollMs = 200 }) {
  let routeSeq = 0;

  /**
   * Method invokes are async: POST returns an id, the CommandAck arrives by polling invoke/<id>.
   * @param {string} interest @param {string} object @param {string} method @param {unknown[]} args
   * @param {string} [target]  the name in the toast (default: the object)
   * @returns {Promise<Result>}
   */
  async function invokeAck(interest, object, method, args, target = object) {
    try {
      const started = await client.invoke(interest, object, method, args);
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, pollMs));
        const res = await client.get(`/api/interests/${interest}/objects/${object}/methods/${method}/invoke/${started.id}`);
        if (res.status !== "finished") continue;
        // CommandAck comes back as a JSON *string* (every World and drone method returns one); no result = accepted.
        const ack = (typeof res.result === "string" ? JSON.parse(res.result) : res.result) || { status: 0, message: "ok" };
        return { target, ok: ack.status === 0, status: member("AckStatus", ack.status) || String(ack.status),
                 message: ack.message };
      }
      return { target, ok: false, status: "rejectedUnavailable", message: "no ack (timeout)" };
    } catch (e) {
      return { target, ok: false, status: "error", message: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Invoke on each object at once, one toast for all.
   * @param {string[]} objects @param {string} method @param {unknown[]} args @param {string} [interest]
   * @returns {Promise<Result[]>}
   */
  async function command(objects, method, args, interest = "swarm") {
    const results = await Promise.all(objects.map((o) => invokeAck(interest, o, method, args)));
    const { text, bad } = summarize(method, results);
    toast(text, bad);
    return results;
  }

  /**
   * One invoke per drone on its object `${prefix}drone<ID>` (drone<ID>, or waypoint_navigator_drone<ID>), the
   * arguments encoded exactly as the method takes them (a wrongly shaped argument crashes the world's
   * REST, patches/sen/upstream-rest-invoke-bad-argument-crash.md). Toasts name drone<ID>.
   * @param {string | string[]} ids @param {string} method @param {unknown[]} [args] @param {string} [prefix]
   * @returns {Promise<Result[]>}
   */
  async function drones(ids, method, args = [], prefix = "") {
    const results = await Promise.all(list(ids).map((id) =>
      invokeAck("swarm", `${prefix}drone${id}`, method, args, `drone${id}`)));
    const { text, bad } = summarize(method, results);
    toast(text, bad);
    return results;
  }

  /** @param {string} path @param {object} body */
  async function postJSON(path, body) {
    const res = await fetch(path, { method: "POST", body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || String(res.status));
    return out;
  }

  return {
    invokeAck,
    /** @param {string | string[]} ids */ arm: (ids) => drones(ids, "arm"),
    /** @param {string | string[]} ids */ takeoff: (ids) => drones(ids, "takeoff", [TAKEOFF_ALT]),
    /** @param {string | string[]} ids */ land: (ids) => drones(ids, "land"),
    /** @param {string | string[]} ids */ disarm: (ids) => drones(ids, "disarm"),
    /** Shift-click: fly straight there at cruise speed (0). @param {string} id @param {GeoPosition} position */
    goTo: (id, position) => drones(id, "goToPosition", [position, 0]),

    /**
     * Send the draft as ONE setRoute (cruise speed) to waypoint_navigator_drone<ID>.
     * The caller empties its draft on accept; a rejected route keeps the operator's clicks.
     * @param {string} id @param {GeoPosition[]} draft
     */
    async sendRoute(id, draft) {
      const [r] = await drones(id, "setRoute", [{ id: ++routeSeq, waypoints: draft.slice() }, 0], "waypoint_navigator_");
      return r;
    },

    /** @param {boolean} paused  World.paused now: pauses, or resumes when paused */
    togglePause: (paused) => command(["world"], paused ? "resume" : "pause", [], "sim"),
    /** @param {number} scale */
    setTimeScale: (scale) => command(["world"], "setTimeScale", [scale], "sim"),

    /**
     * Start a drone's compose project (serve.py /spawn). The drone appears once its SEN objects are discovered.
     * @param {number} lat @param {number} lon @returns {Promise<string | null>} the new id
     */
    async spawn(lat, lon) {
      try {
        return String((await postJSON("/spawn", { lat, lon })).id);
      } catch (e) {
        toast(`spawn failed: ${e instanceof Error ? e.message : e}`, true);
        return null;
      }
    },

    /**
     * "Reset simulation" (serve.py /reset): the stack restarts to scenarios/initial.yaml, one toast.
     * @returns {Promise<boolean>} accepted
     */
    async reset() {
      try {
        const { drones = [] } = await postJSON("/reset", {});
        toast(`reset: ${drones.length} drone(s) starting`, false);
        return true;
      } catch (e) {
        toast(`reset failed: ${e instanceof Error ? e.message : e}`, true);
        return false;
      }
    },

    /** "Remove" (serve.py /kill): the drones' compose projects down one after another (serve.py takes one
     * at a time, 409 otherwise), one toast. @param {string | string[]} ids @returns {Promise<Result[]>} */
    async remove(ids) {
      const results = [];
      for (const id of list(ids)) {
        results.push(await postJSON("/kill", { id })
          .then(() => ({ target: "drone" + id, ok: true, status: "accepted", message: "removed" }))
          .catch((e) => ({ target: "drone" + id, ok: false, status: "error", message: e.message })));
      }
      const { text, bad } = summarize("remove", results);
      toast(text, bad);
      return results;
    },
  };
}
