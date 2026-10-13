// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The inspector. A drone: status banner, route chip, altitude, ground
// speed, heading, battery, the safety block (C2 link), position, distance
// from base.
import { html } from "preact-htm";
import { kmFromBase } from "../model/derive.js";
import { label, ordinal } from "../model/enums.js";
import { COLOURS } from "../scene/aircraft.js";
import { Icon } from "./Dock.js";
import { Mock } from "./Layers.js";
import { shown } from "../model/provenance.js";

/** @typedef {import("./App.js").App} App */
/** @typedef {import("../model/types.js").Drone} Drone */
/** @typedef {import("../model/types.js").Status} Status */

const WORD = { critical: "Critical", caution: "Caution", nominal: "Nominal", idle: "Idle" };

const NAVIGATING = ordinal("NavigatorStatus", "navigating");
/** @param {number | undefined} v @param {number} [digits] */
const num = (v, digits = 0) => (v === undefined ? "–" : v.toFixed(digits));

/** @param {{status: Status, reason: string}} props */
const Banner = ({ status, reason }) =>
  html`<div class=${`banner ${status}`}><span class=${`dot ${status}`}></span>${WORD[status]}<span class="r">${reason}</span></div>`;

/** @param {{cap: string, value: string, unit: string, sub?: string, cls?: string}} props */
const Cell = ({ cap, value, unit, sub = "", cls = "" }) =>
  html`<div><div class="cap">${cap}</div><div class=${`v ${cls}`}>${value}<small>${unit}</small></div><div class="s">${sub}</div></div>`;

/**
 * The safety block: [name, status, word] per row. C2 as the ground sees it: drone<ID> on swarm.bus and
 * fleet_status liveness.
 * @param {Drone} d @returns {[string, Status, string][]}
 */
function safety(d) {
  return [
    d.alive === false ? ["C2 link", "critical", "Lost"] : !d.linked ? ["C2 link", "idle", "No link"] : ["C2 link", "nominal", "Up"],
  ];
}

/**
 * Follow and Deselect. Follow keeps the camera on it (view.js) until a pan, a deselect or another selection.
 * @param {{app: App, name: string, on: () => boolean}} props  name: the view preset; on: still selected
 */
function Buttons({ app, name, on }) {
  const following = app.act.following() === name;
  return html`<div style=${{ display: "flex", gap: "6px" }}>
    <button class=${`mbtn${following ? " on" : ""}`} title="Keep the camera on it (a pan stops it)"
      onClick=${() => { app.act.follow(following ? null : name, on); app.act.refresh(); }}>Follow</button>
    <button class="xbtn" title="Deselect (Esc)" onClick=${app.act.deselect}><${Icon} name="x"/></button></div>`;
}

/** @param {{app: App, id: string}} props */
function DroneView({ app, id }) {
  const { store } = app, d = store.drones.get(id), i = app.info.get(id);
  if (!d || !i) return null;
  const s = d.truth, p = s.position, o = store.world.origin, battery = d.link.battery ?? s.battery;
  const route = d.link.navigatorStatus === undefined ? "–"
    : `${label("NavigatorStatus", d.link.navigatorStatus)}${d.link.waypointIndex ? ` · WP ${d.link.waypointIndex}` : ""}`
      + (d.link.navigatorStatus === NAVIGATING && d.link.distanceToNext !== undefined ? ` · ${num(d.link.distanceToNext)} m` : "");
  return html`<div class="ins">
      <div class="h"><div><h2><span class="sw2 big" style=${{ background: COLOURS.friendly }}></span>drone${id}</h2>
        <div class="sub"><${Mock} store=${store} k="airframe">fixed-wing</${Mock}></div></div>
        <${Buttons} app=${app} name=${`drone:${id}`} on=${() => store.selectedId === id}/></div>
      <${Banner} status=${i.status} reason=${i.reason}/>
      <div class="chips"><span class="chip">Route <b>${route}</b></span></div>
      ${app.ui.routes.has(id) && shown(store, "routes") && html`<div class="note"><${Mock} store=${store} k="routes" tag>On the map: the route as sent from this page</${Mock}></div>`}
    </div>
    <div class="grid4 num">
      <${Cell} cap="Altitude" value=${p ? num(p.altitude - (o?.altitude ?? 0)) : "–"} unit="m AGL"
        sub=${`${p ? num(p.altitude) : "–"} m MSL · climb ${num(s.verticalSpeed, 1)}`}/>
      <${Cell} cap="Ground speed" value=${num(s.groundSpeed, 1)} unit="m/s" sub=${`course ${num(s.course)}°`}/>
      <${Cell} cap="Heading" value=${num(s.heading)} unit="°" sub=${`mode ${label("FlightMode", d.link.mode ?? s.mode) || "–"}`}/>
      <${Cell} cap="Battery" value=${battery === undefined ? "–" : String(Math.round(battery * 100))} unit="%"
        cls=${battery !== undefined && battery < 0.3 ? "tcrit" : ""} sub=${o && p ? `From base ${kmFromBase(o, p).toFixed(1)} km` : ""}/>
    </div>
    <div class="kv"><div class="cap">Safety</div>
      ${safety(d).map(([k, st, v]) => html`<div class="r">${k}<b><span class=${`dot ${st}`}></span>${v}</b></div>`)}
      <div class="r">Position<b class="mono">${p ? `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}` : "–"}</b></div>
    </div>`;
}

/** @param {{app: App}} props */
export function Inspector({ app }) {
  const t = app.target;
  if (!t) return html`<div class="ins"><div class="sub">Click an aircraft or a fleet row to inspect it.</div></div>`;
  return html`<${DroneView} app=${app} id=${t.ids[0]}/>`;
}
