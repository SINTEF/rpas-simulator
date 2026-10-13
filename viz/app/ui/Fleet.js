// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The fleet panel: Needs attention (anything not nominal, worst first), Airborne,
// On ground; the layers and legend at the bottom. Row: identity bar, status dot, id, state word,
// battery bar, altitude, speed.
import { html } from "preact-htm";
import { fleetSections } from "../model/fleet.js";
import { label } from "../model/enums.js";
import { COLOURS } from "../scene/aircraft.js";
import { Layers } from "./Layers.js";

/** @typedef {import("./App.js").App} App */

const TEXT = { critical: "tcrit", caution: "twarn", idle: "tidle", nominal: "" };

/** The word for a drone's state: its flight mode. @param {import("../model/types.js").Drone} d */
export function stateWord(d) {
  return label("FlightMode", d.link.mode ?? d.truth.mode) || "–";
}

/** @param {{app: App, id: string, attention?: boolean}} props */
function Row({ app, id, attention = false }) {
  const d = app.store.drones.get(id), i = app.info.get(id);
  if (!d || !i) return null;
  const battery = Math.round((d.link.battery ?? d.truth.battery ?? 0) * 100);
  const cls = `row${app.store.selectedId === id ? " sel" : ""}${attention ? ` att-${i.status}` : ""}`;
  const alt = d.truth.position ? `${Math.round(d.truth.position.altitude - (app.store.world.origin?.altitude ?? 0))} m` : "–";
  const speed = d.truth.groundSpeed === undefined ? "" : ` · ${d.truth.groundSpeed.toFixed(1)} m/s`;
  return html`<div class=${cls} onClick=${() => app.act.select(id)}>
    <span class="sw2 tall" style=${{ background: COLOURS.friendly }}></span><span class=${`dot ${i.status}`}></span>
    <div class="main">
      <div class="l1"><span class="id">drone${id}</span>
        <span class=${`tag ${TEXT[i.status]}`}>${attention ? i.status[0].toUpperCase() + i.status.slice(1) : stateWord(d)}</span></div>
      <div class="l2 num"><span class=${`bar${battery < 30 ? " lo" : ""}`}><i style=${{ width: `${battery}%` }}></i></span>
        <span class="pct">${battery} %</span>
        ${attention ? html`<span class=${TEXT[i.status]}>${i.reason}</span>` : html`<span>${alt}${speed}</span>`}</div>
    </div>
  </div>`;
}

/** @param {{app: App}} props */
export function Fleet({ app }) {
  const { store, info } = app;
  const s = fleetSections(store.drones, info);
  /** @param {string} name @param {unknown} [count] */
  const sec = (name, count) => html`<div class="sec"><span class="cap">${name}</span><span class="cnt">${count}</span></div>`;
  return html`<aside class="panel" id="fleet">
    <div class="ph"><h3>Fleet</h3><span class="cap num">${store.drones.size} aircraft</span></div>
    <div class="list">
      ${s.attention.length > 0 && html`${sec("Needs attention", html`<span class=${s.attention.some((id) => info.get(id)?.status === "critical") ? "tcrit" : "twarn"}>${s.attention.length}</span>`)}
        ${s.attention.map((id) => html`<${Row} key=${id} app=${app} id=${id} attention/>`)}`}
      ${s.airborne.length > 0 && html`<div class="grp"><b>AIRBORNE</b></div>${s.airborne.map((id) => html`<${Row} key=${id} app=${app} id=${id}/>`)}`}
      ${s.ground.length > 0 && html`<div class="grp"><b>ON GROUND</b></div>${s.ground.map((id) => html`<${Row} key=${id} app=${app} id=${id}/>`)}`}
      ${store.drones.size === 0 && html`<div class="empty">No drones on the buses</div>`}
    </div>
    <${Layers} app=${app}/>
  </aside>`;
}
