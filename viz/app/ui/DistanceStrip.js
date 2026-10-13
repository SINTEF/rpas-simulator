// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The distance strip under the top bar: 0 … N km from the base (World.origin), every
// unit as a dot at its distance (friendly blue with a red ring when critical, a hostile vehicle a
// red-orange ◇), the no-fly zones' distance spans hatched (mock-up
// airspace), a bracket for the distances the view shows. N is fixed by what is there (units, and with
// the airspace shown zones and the geocage), not by the view. A group's name (a cluster) is mock-up. Labels most urgent first, in two rows; a dot
// whose label finds no room keeps its dot. Click a dot: fly there.
import { html } from "preact-htm";
import { geocage, noFlyZones, radialSpan, stripLength, stripRows, stripTicks } from "../model/distance.js";
import { unitName, worst } from "../model/fleet.js";
import { STATUS_RANK } from "../model/derive.js";
import { COLOURS } from "../scene/aircraft.js";
import { MOCK, mockGroup, shown } from "../model/provenance.js";

/** @typedef {import("./App.js").App} App */

const CHAR_PX = 6.2; // label width estimate per character, px (10 px Inter, semibold)

/** @param {{app: App}} props */
export function DistanceStrip({ app }) {
  const { store, screen, info, act } = app, base = screen.base;
  const track = (/** @type {unknown} */ content) =>
    html`<div class="panel" id="strip"><span class="lbl">From base</span><div class="track">${content}</div><span class="lbl">km</span></div>`;
  if (!base) return track(null);
  const km = (/** @type {[number, number]} */ p) => Math.hypot(p[0] - base[0], p[1] - base[1]) / 1000;
  const air = shown(store, "airspace");
  const spans = air ? [...noFlyZones(store.world.airspace).values()].map((v) => radialSpan(v.map(screen.local), base).map((m) => m / 1000)) : [];
  const cage = geocage(store.geocage, store.world.airspace); // SEN data when live, else mock-up airspace
  const cageKm = cage && (cage.live || air) ? radialSpan(cage.vertices.map(screen.local), base)[1] / 1000 : 0;
  const marks = app.units.map((u) => ({ id: u.id, name: unitName(u), km: km([u.members[0].x, u.members[0].z]),
    vehicle: u.kind === "vehicle", mock: mockGroup(u),
    status: u.kind === "vehicle" ? null : worst(u.members.map((m) => info.get(m.id)?.status || "idle")) }))
    .sort((a, b) => (a.status ? STATUS_RANK[a.status] : 4) - (b.status ? STATUS_RANK[b.status] : 4) || a.km - b.km);
  const length = stripLength(Math.max(1, cageKm, ...marks.map((m) => m.km), ...spans.map((s) => s[1])));
  const at = (/** @type {number} */ k) => Math.min(Math.max(k / length, 0), 1);
  const pct = (/** @type {number} */ k) => `${(at(k) * 100).toFixed(2)}%`;
  const width = Math.max(200, innerWidth - 304 - 328 - 140); // the track, px: the page minus panels and the strip's own labels
  const texts = ["Base", ...marks.map((m) => `${m.name} · ${m.km.toFixed(1)} km`)];
  const rows = stripRows(texts.map((t, i) => ({ x: i ? at(marks[i - 1].km) * width : (t.length * CHAR_PX) / 2 - 4, width: t.length * CHAR_PX })));
  const view = screen.view && radialSpan(screen.view, base).map((m) => m / 1000);
  const label = (/** @type {number} */ i, /** @type {string} */ cls) =>
    rows[i] >= 0 && html`<em class=${`r${rows[i]} ${cls}`}>${texts[i]}</em>`;
  return track(html`
    ${stripTicks(length).map((t) => html`<div class=${`tk${t.major ? " maj" : ""}`} style=${{ left: pct(t.km) }}>
      ${t.major && html`<span>${Number(t.km.toFixed(1))}</span>`}</div>`)}
    ${spans.map(([a, b]) => html`<div class="nfzb" style=${{ left: pct(a), width: `${Math.max(0.4, (at(b) - at(a)) * 100).toFixed(2)}%` }}></div>`)}
    ${view && html`<div class="view" style=${{ left: pct(view[0]), width: `${Math.max(0.6, (at(view[1]) - at(view[0])) * 100).toFixed(2)}%` }}></div>`}
    <div class="mk" style=${{ left: "0%" }} onClick=${() => act.fly("base")}><i class="dia"></i>${label(0, "first")}</div>
    ${marks.map((m, i) => html`<div class="mk" key=${m.id} style=${{ left: pct(m.km) }} title=${m.mock ? MOCK.groups : ""} onClick=${() => act.fly(m.id)}>
      <i class=${m.vehicle ? "hos" : m.status === "critical" ? "c" : ""}
        style=${{ background: m.vehicle ? COLOURS.hostile : COLOURS.friendly }}></i>
      ${label(i + 1, m.mock ? "mock" : m.status === "critical" ? "tcrit" : "")}</div>`)}`);
}
