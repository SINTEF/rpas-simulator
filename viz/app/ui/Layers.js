// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Layers and legend at the foot of the fleet panel. The layers are the ones the
// view has so far: "Min size" (the minimum on-screen size rule, store.minSize), "Airspace", "Range
// rings" and "Mock-up data" (store.mock, model/provenance.js: default off, remembered per viewer).
// Also the one helper panels mark mock-up with.
import { html } from "preact-htm";
import { COLOURS } from "../scene/aircraft.js";
import { MOCK, shown } from "../model/provenance.js";

/** @typedef {import("./App.js").App} App */

const KEY = "swarm.mock";

/** The viewer's last "Mock-up data" choice; off when never set or storage is blocked. */
export function rememberedMock() {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

/**
 * Mock-up in a panel: nothing while hidden, else the children in the mock style (violet, italic),
 * titled with its MOCK line, with a "mock" tag when `tag`.
 * @param {{store: {mock: boolean}, k: import("../model/provenance.js").MockKey, tag?: boolean, children?: unknown}} props
 */
export function Mock({ store, k, tag = false, children }) {
  return shown(store, k) ? html`<span class="mock" title=${MOCK[k]}>${children}${tag && html`<span class="mtag">mock</span>`}</span>` : null;
}

/** @param {{app: App}} props */
export function Layers({ app }) {
  const { store, act } = app;
  /** @param {string} name @param {"minSize" | "airspace" | "rangeRings" | "mock"} key */
  const toggle = (name, key) => {
    const mock = key in MOCK, dim = mock && !store.mock;
    const flip = () => {
      store[key] = !store[key];
      if (key === "mock") try { localStorage.setItem(KEY, store.mock ? "1" : "0"); } catch { /* not remembered */ }
      act.refresh();
    };
    return html`<label class=${`${mock ? "mock" : ""}${dim ? " dim" : ""}`} title=${mock ? MOCK[/** @type {"airspace"} */ (key)] : ""}
      onClick=${flip}>${name}<span class=${`sw${store[key] ? "" : " off"}`}></span></label>`;
  };
  return html`<div class="layers">
    <span class="cap">Layers</span>
    <div class="tg">${toggle("Min size", "minSize")}${toggle("Airspace", "airspace")}
      ${toggle("Range rings", "rangeRings")}${toggle("Mock-up data", "mock")}</div>
    <div class="legend"><b class="lg">Friendly</b><span><i class="swl" style=${{ background: COLOURS.friendly }}></i>Drone</span></div>
    <div class="legend"><b class="lg">Hostile</b><span><i class="hsym"></i>red-orange body · ◇ frame</span></div>
    <div class="legend"><b class="lg">Status</b>
      <span><i class="rg nominal"></i>OK</span><span><i class="rg caution"></i>Caution</span>
      <span><i class="rg critical"></i>Crit</span><span><i class="rg idle"></i>Idle</span></div>
    ${store.mock && html`<div class="legend"><b class="lg">Mock-up</b>
      <span class="mock"><i class="swl" style=${{ background: COLOURS.mock }}></i>not backed by the SEN skeleton yet</span></div>`}
  </div>`;
}
