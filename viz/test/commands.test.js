// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The command layer against a fake SenClient and fetch: no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applicable, createCommands, waypointAt, TAKEOFF_ALT } from "../app/sen/commands.js";
import { ordinal } from "../app/model/enums.js";

/**
 * A client whose invokes finish at the first poll with the ack acks[object] ({status, message}), or throw
 * when acks[object] is an Error. Records every invoke.
 * @param {Record<string, any>} acks
 */
function fakeClient(acks) {
  /** @type {{interest: string, object: string, method: string, args: unknown[]}[]} */
  const calls = [];
  return {
    calls,
    async invoke(/** @type {string} */ interest, /** @type {string} */ object, /** @type {string} */ method, /** @type {unknown[]} */ args) {
      if (acks[object] instanceof Error) throw acks[object];
      calls.push({ interest, object, method, args });
      return { id: object };
    },
    async get(/** @type {string} */ href) {
      const object = href.split("/").pop() || "";
      const ack = acks[object];
      return { status: "finished", result: ack === undefined ? undefined : JSON.stringify(ack) };
    },
  };
}

function setup(/** @type {Record<string, any>} */ acks, fetch = /** @type {any} */ (undefined)) {
  const client = fakeClient(acks);
  /** @type {{text: string, bad: boolean}[]} */
  const toasts = [];
  const commands = createCommands({ client, toast: (text, bad) => toasts.push({ text, bad }), fetch, pollMs: 0 });
  return { client, toasts, commands };
}

test("AckStatus is decoded from the ordinal; a void result is accepted", async () => {
  const { commands } = setup({ drone1: { status: ordinal("AckStatus", "rejectedState"), message: "not armed" } });
  assert.deepEqual(await commands.invokeAck("swarm", "drone1", "takeoff", [TAKEOFF_ALT]),
                   { target: "drone1", ok: false, status: "rejectedState", message: "not armed" });
  assert.deepEqual(await commands.invokeAck("sim", "world", "pause", []),
                   { target: "world", ok: true, status: "accepted", message: "ok" });
});

test("a group command fans out per drone with one aggregated toast", async () => {
  const { client, toasts, commands } = setup({
    drone1: { status: 0, message: "armed" }, drone2: { status: 0, message: "armed" },
    drone3: { status: ordinal("AckStatus", "rejectedUnavailable"), message: "no drone3" }, drone4: new Error("POST 500") });
  const results = await commands.arm(["1", "2", "3", "4"]);
  assert.deepEqual(client.calls.map((c) => `${c.interest}:${c.object}.${c.method}(${JSON.stringify(c.args)})`),
                   ['swarm:drone1.arm([])', 'swarm:drone2.arm([])', 'swarm:drone3.arm([])']);
  assert.deepEqual(results.map((r) => r.ok), [true, true, false, false]);
  assert.deepEqual(toasts, [{ bad: true,
    text: "arm ×4: 2 accepted, drone3 rejectedUnavailable: no drone3, drone4 failed: POST 500" }]);
});

test("one drone toasts its ack; a sent route is the draft as one setRoute on waypoint_navigator_drone<ID>", async () => {
  const { client, toasts, commands } = setup({ waypoint_navigator_drone1: { status: 0, message: "route set" },
                                               waypoint_navigator_drone2: { status: 1, message: "empty" } });
  const draft = [{ latitude: 59.9, longitude: 10.7, altitude: 200 }];
  assert.equal((await commands.sendRoute("1", draft)).ok, true);
  assert.equal(draft.length, 1); // the caller empties its draft
  assert.deepEqual(client.calls[0], { interest: "swarm", object: "waypoint_navigator_drone1", method: "setRoute",
    args: [{ id: 1, waypoints: [{ latitude: 59.9, longitude: 10.7, altitude: 200 }] }, 0] });
  const kept = [{ latitude: 1, longitude: 2, altitude: 3 }];
  await commands.sendRoute("2", kept);
  assert.equal(kept.length, 1);
  assert.deepEqual(toasts, [{ text: "drone1.setRoute: route set", bad: false },
                            { text: "drone2.setRoute: empty", bad: true }]);
});

test("every drone command goes to drone<ID> itself, the drone's argument shapes kept", async () => {
  const { client, commands } = setup({});
  const position = { latitude: 59.9, longitude: 10.7, altitude: 150 };
  await commands.arm("1"); await commands.takeoff("1"); await commands.land("1"); await commands.disarm("1");
  await commands.goTo("1", position);
  assert.deepEqual(client.calls.map((c) => [c.interest, c.object, c.method, c.args]), [
    ["swarm", "drone1", "arm", []],
    ["swarm", "drone1", "takeoff", [TAKEOFF_ALT]],
    ["swarm", "drone1", "land", []],
    ["swarm", "drone1", "disarm", []],
    // GeoPosition as an object, speed a number: a wrong shape crashes the REST
    ["swarm", "drone1", "goToPosition", [{ latitude: 59.9, longitude: 10.7, altitude: 150 }, 0]]]);
  assert.equal(typeof client.calls[1].args[0], "number");
});

test("clock, spawn and remove", async () => {
  /** @type {{path: string, body: any}[]} */
  const posts = [];
  const fetch = async (/** @type {string} */ path, /** @type {any} */ init) => {
    const body = JSON.parse(init.body);
    posts.push({ path, body });
    const ok = body.id !== "9";
    return { ok, status: ok ? 200 : 404, json: async () => (ok ? { id: 7 } : { error: "no drone compose project drone9" }) };
  };
  const { client, toasts, commands } = setup({}, fetch);
  await commands.togglePause(true);
  assert.deepEqual(client.calls[0], { interest: "sim", object: "world", method: "resume", args: [] });
  assert.equal(await commands.spawn(59.9, 10.7), "7");
  toasts.length = 0;
  await commands.remove(["2", "9"]);
  assert.deepEqual(posts.slice(1).map((p) => p.body.id), ["2", "9"]);
  assert.deepEqual(toasts, [{ text: "remove ×2: 1 accepted, drone9 failed: no drone compose project drone9", bad: true }]);
});

test("reset posts /reset, one toast; a busy server's error is toasted", async () => {
  /** @type {{path: string, body: any}[]} */
  const posts = [];
  let status = 200;
  const fetch = async (/** @type {string} */ path, /** @type {any} */ init) => {
    posts.push({ path, body: JSON.parse(init.body) });
    const ok = status === 200;
    return { ok, status, json: async () => (ok ? { drones: ["1", "2"] } : { error: "busy: a reset, spawn or remove is running" }) };
  };
  const { client, toasts, commands } = setup({}, fetch);
  assert.equal(await commands.reset(), true);
  assert.deepEqual(posts, [{ path: "/reset", body: {} }]);
  assert.deepEqual(client.calls, []); // nothing over SEN: the restart is serve.py's
  status = 409;
  assert.equal(await commands.reset(), false);
  assert.deepEqual(toasts, [{ text: "reset: 2 drone(s) starting", bad: false },
                            { text: "reset failed: busy: a reset, spawn or remove is running", bad: true }]);
});

test("applicability: selection, the drone's link, the draft", () => {
  const linked = { id: "1", truth: {}, link: { mode: 0 }, linked: true };
  const unlinked = { id: "2", truth: {}, link: {} };
  // drone<ID> gone but node status still in the record: not linked
  assert.equal(applicable("arm", { id: "3", truth: {}, link: { navigatorStatus: 1, waypointIndex: 2 }, linked: false }), false);
  assert.equal(applicable("arm", null), false);
  assert.equal(applicable("arm", linked), true);
  assert.equal(applicable("arm", unlinked), false);
  assert.equal(applicable("remove", unlinked), true);
  assert.equal(applicable("sendRoute", linked), false);
  assert.equal(applicable("sendRoute", linked, 2), true);
  assert.equal(applicable("clearRoute", null, 1), true);
  assert.equal(applicable("spawn", null), true);
  assert.throws(() => applicable("kill", linked));
  // crashed: every command dimmed but remove
  const wreck = { id: "4", truth: {}, link: { mode: ordinal("FlightMode", "crashed") }, linked: true };
  for (const c of ["arm", "takeoff", "land", "disarm", "goTo", "addWaypoint"]) assert.equal(applicable(c, wreck), false, c);
  assert.equal(applicable("sendRoute", wreck, 2), false);
  assert.equal(applicable("clearRoute", wreck, 1), true); // UI only
  assert.equal(applicable("remove", wreck), true);
});

test("draft waypoint altitude", () => {
  const low = { id: "1", truth: { position: { latitude: 0, longitude: 0, altitude: 50 } }, link: {} };
  assert.equal(waypointAt(1, 2, low, 30).altitude, 30 + TAKEOFF_ALT);
  assert.equal(waypointAt(1, 2, { ...low, truth: { position: { latitude: 0, longitude: 0, altitude: 500 } } }, 30).altitude, 500);
});
