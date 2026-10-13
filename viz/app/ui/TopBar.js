// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The top bar: logo, breadcrumb (Theatre › drone), the theatre preset, Reset
// simulation, zoom ± , the simulator version, run state, sim clock, time scale, counts.
import { html } from "preact-htm";
import { Icon } from "./Dock.js";
import { counts } from "../model/fleet.js";

/** @typedef {import("./App.js").App} App */

/** "T+ hh:mm:ss" of sim seconds. */
function clockText(/** @type {number} */ seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const two = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `T+ ${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

/** @param {{app: App}} props */
export function TopBar({ app }) {
  const { store, act } = app, w = store.world;
  const [dot, run] = app.ui.resetting ? ["idle", "Resetting…"] : !store.connected ? ["critical", "Disconnected"] : w.paused ? ["idle", "Paused"] : ["nominal", "Running"];
  const n = counts(store.drones, store.assets, app.info);
  const preset = location.hash.slice(1) || "far";
  const drone = store.selectedId;
  /** @param {string} name @param {unknown} body @param {boolean} [cur] */
  const crumb = (name, body, cur = false) =>
    html`<a class=${cur ? "cur" : ""} onClick=${() => act.fly(name)}>${body}</a>`;
  return html`<header id="top">
    <div class="brand"><div class="logo"><svg viewBox="0 0 24 24"><path d="M2 13l9-2 3-7 2 1-1 6 7 1v2l-7 1 1 6-2 1-3-7-9-2z"/></svg></div>
      <div><b>SEN Swarm</b> <span>· Theatre model</span></div></div>
    <div class="crumb">
      ${crumb("far", "Theatre", !drone)}
      ${drone && html`<span class="sep">›</span>${crumb(`drone:${drone}`, `drone${drone}`, true)}`}
    </div>
    <div class="seg">
      <a class=${preset === "far" ? "on" : ""} onClick=${() => act.fly("far")}>Theatre · ${app.theatre}</a>
    </div>
    <button class="mbtn" title="Back to scenarios/initial.yaml: every drone removed, the initial ones start at the base, clock 0"
      disabled=${app.ui.resetting} onClick=${act.reset}><${Icon} name="reset"/>Reset simulation</button>
    <div class="zbtns">
      <button title="Zoom out" onClick=${() => act.zoom(1 / 1.6)}><${Icon} name="minus"/></button>
      <button title="Zoom in" onClick=${() => act.zoom(1.6)}><${Icon} name="plus"/></button>
    </div>
    <span class="version">SINTEF RPAS simulator ${app.version}</span>
    <div class="clock">
      <div class="runpill"><span class=${`dot ${dot}`}></span>${run}</div>
      <span class="t">${clockText(w.simTime ?? 0)}</span>
      <span class="mono">${w.timeScale === undefined ? "" : `×${+w.timeScale.toFixed(1)}`}</span>
      <div class="kpis num">
        <div><b>${n.aircraft}</b><span>Aircraft</span></div>
        <div><b>${n.airborne}</b><span>Airborne</span></div>
        <div><b class=${n.critical ? "tcrit" : ""}>${n.critical}</b><span>Critical</span></div>
        <div><b class=${n.caution ? "twarn" : ""}>${n.caution}</b><span>Caution</span></div>
        <div><b>◇ ${n.vehicles}</b><span>Hostile</span></div>
      </div>
    </div>
  </header>`;
}
