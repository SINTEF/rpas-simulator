// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The command dock: "Commanding …" chip, then every command in
// groups — flight, fault / end, route, spawn, time. A command that does not apply to what is
// selected is dimmed, not hidden. Also the icon set of the panels (from the UI mockup).
import { html } from "preact-htm";
import { applicable } from "../sen/commands.js";
import { COLOURS } from "../scene/aircraft.js";

/** @typedef {import("./App.js").App} App */

/** @type {Record<string, string>} SVG path data, 24 × 24 */
const PATHS = {
  arm: "M12 3v8M6.5 6.5a8 8 0 1 0 11 0", up: "M12 19V5M6 11l6-6 6 6M5 21h14", down: "M12 3v14M6 11l6 6 6-6M5 21h14",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  remove: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M9 9l6 6M15 9l-6 6",
  wp: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM9.7 9.5a2.3 2.3 0 1 0 4.6 0a2.3 2.3 0 1 0-4.6 0",
  send: "M21 3L10 14M21 3l-7 18-4-7-7-4z", clear: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14",
  spawn: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 8v8M8 12h8", pause: "M9 6v12M15 6v12",
  play: "M8 5l11 7-11 7z", x: "M6 6l12 12M18 6L6 18", plus: "M12 5v14M5 12h14", minus: "M5 12h14",
  reset: "M4 12a8 8 0 1 0 2.3-5.6M4 4v5h5",
};

/** @param {{name: string}} props */
export function Icon({ name }) {
  return html`<svg class="i" viewBox="0 0 24 24"><path d=${PATHS[name]}/></svg>`;
}

/**
 * @param {{app: App}} props
 */
export function Dock({ app }) {
  const { store, ui, act, target } = app, w = store.world;
  const draft = ui.draft.length;
  const ids = target ? target.ids : [];
  const shown = target && ui.routes.has(ids[0]) ? 1 : 0; // Clear also clears the route shown for it
  const can = (/** @type {string} */ c) => applicable(c, target ? store.drones.get(ids[0]) : null, c === "clearRoute" ? draft + shown : draft);
  /**
   * @param {string} icon @param {string} text @param {string} command @param {() => void} run
   * @param {string} [cls] @param {string} [title]
   */
  const B = (icon, text, command, run, cls = "", title = "") => {
    const on = can(command);
    return html`<button class=${`b ${cls}${on ? "" : " dis"}`} disabled=${!on} title=${title} onClick=${run}>
      <${Icon} name=${icon}/><span>${text}</span></button>`;
  };
  const scale = ui.scaleDraft ?? w.timeScale ?? 1;
  const status = target && app.info.get(ids[0])?.status;
  return html`<div class="panel" id="dock">
    <div class="cmdchip">
      ${target && html`<span class="sw2 tall" style=${{ background: COLOURS.friendly }}></span><span class=${`dot ${status}`}></span>`}
      <div><div class="cap">Commanding</div><b>${target ? target.name : "Nothing selected"}</b></div>
    </div>
    ${B("arm", "Arm", "arm", () => act.run("arm"))}
    ${B("up", "Takeoff", "takeoff", () => act.run("takeoff"))}
    ${B("down", "Land", "land", () => act.run("land"))}
    ${B("lock", "Disarm", "disarm", () => act.run("disarm"))}
    <div class="vsep"></div>
    ${B("remove", "Remove", "remove", act.remove, "red", "take the drone out of the sim (its whole compose project)")}
    <div class="vsep"></div>
    ${B("wp", "Add WP", "addWaypoint", () => act.setMode("waypoint"), ui.mode === "waypoint" ? "on" : "",
      "then click the map: a draft waypoint · double-click: the last one, and send · shift-click: go there now")}
    ${B("send", "Send", "sendRoute", act.sendRoute, "", "the draft as one route")}
    ${B("clear", "Clear", "clearRoute", act.clearDraft, "", "empty the draft and the route shown")}
    <div class="vsep"></div>
    ${B("spawn", "Spawn", "spawn", () => act.setMode("spawn"), ui.mode === "spawn" ? "on" : "",
      "then click the map where the new drone should stand · Esc cancels")}
    <div class="vsep"></div>
    <div class="time">
      <button class="play" title=${w.paused ? "Resume" : "Pause"} onClick=${act.togglePause}>
        <${Icon} name=${w.paused ? "play" : "pause"}/></button>
      <input class="slider" type="range" min="0.1" max="10" step="0.1" value=${scale} title="Time scale"
        onInput=${(/** @type {Event} */ e) => act.scaleDraft(+(/** @type {HTMLInputElement} */ (e.target)).value)}
        onChange=${(/** @type {Event} */ e) => act.setTimeScale(+(/** @type {HTMLInputElement} */ (e.target)).value)}/>
      <span class="ts">×${(+scale).toFixed(1)}</span>
    </div>
  </div>`;
}
