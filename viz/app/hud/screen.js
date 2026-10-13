// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Screen-space distance aids over the 3D view: an edge tab at the border of the free
// map area for every unit and the base off screen (arrow, name, status dot, km from the view's
// centre; click = fly there).
// Also what the distance strip reads (ui/DistanceStrip.js): the base and the view's footprint on the
// ground; and the base as a camera preset ("base").
import * as THREE from "three";
import { geoToLocal } from "../model/geo.js";
import { edgeTab, stackTabs, f1 } from "../model/distance.js";
import { unitName } from "../model/fleet.js";
import { STATUS_RANK } from "../model/derive.js";
import { COLOURS } from "../scene/aircraft.js";
import { MOCK, mockGroup } from "../model/provenance.js";

/** @typedef {import("../model/types.js").Unit} Unit */
/** @typedef {import("../model/store.js").Store} Store */
/** @typedef {import("../scene/aircraft.js").Drawn} Drawn */
/** @typedef {import("../model/distance.js").Point} Point */
/** @typedef {import("../model/distance.js").Rect} Rect */
/**
 * What the panels read: scene metres (x east, z south).
 * @typedef {Object} ScreenState
 * @property {Point | null} base         World.origin
 * @property {Point[] | null} view       the free map area's corners on the ground
 * @property {Rect} rect                 the free map area between the panels, px
 * @property {(p: {latitude: number, longitude: number}) => Point} local
 */

const BASE_ZOOM = 0.25;   // px per metre of the base preset: ~5 km across
const RECT_MS = 500;      // the free map area is re-measured this often (panels may change size)

/**
 * @param {{camera: THREE.OrthographicCamera, controls: {target: THREE.Vector3}, go: (name: string) => void,
 *          origin: import("../model/geo.js").LatLon, groundAt: (x: number, z: number) => number}} options  origin: the scene's
 */
export function createScreen({ camera, controls, go, origin, groundAt }) {
  const layer = /** @type {HTMLElement} */ (document.getElementById("tabs"));
  /** @type {Map<string, {el: HTMLElement, arrow: SVGElement, km: HTMLElement, key: string, w: number, h: number}>} */
  const tabs = new Map();
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0)), v = new THREE.Vector3();
  let rectAt = -Infinity;
  /** @type {ScreenState} */
  const state = { base: null, view: null, rect: { l: 0, t: 0, r: innerWidth, b: innerHeight },
    local: (p) => { const l = geoToLocal(origin, p.latitude, p.longitude); return [l.x, l.z]; } };

  /** The map area between the panels (above the dock), px. */
  function measure() {
    const r = (/** @type {string} */ id) => document.getElementById(id)?.getBoundingClientRect();
    state.rect = { l: (r("fleet")?.right ?? 0) + 8, t: (r("strip")?.bottom ?? r("top")?.bottom ?? 0) + 8,
             r: (r("right")?.left ?? innerWidth) - 8, b: (r("dock")?.top ?? innerHeight) - 8 };
  }

  /**
   * On the level of the ground under the view's target (a drone preset puts the target in the air).
   * @param {number} x @param {number} y screen px @param {number} vex @returns {Point | null}
   */
  function ground(x, y, vex) {
    ray.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, 1 - (y / innerHeight) * 2), camera);
    plane.constant = -groundAt(controls.target.x, controls.target.z) * vex;
    return ray.ray.intersectPlane(plane, v) ? [v.x, v.z] : null;
  }

  /** @param {number} x @param {number} y @param {number} z @returns {Point} */
  const screen = (x, y, z) => {
    v.set(x, y, z).project(camera);
    return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
  };

  /**
   * One frame, after aircraft.update().
   * @param {Unit[]} units @param {Drawn[]} drawn @param {Store} store @param {number} vex @param {number} now ms
   */
  function update(units, drawn, store, vex, now) {
    if (now - rectAt > RECT_MS) { rectAt = now; measure(); }
    const rect = state.rect;
    const base = (state.base = store.world.origin ? state.local(store.world.origin) : null);
    const corners = [ground(rect.l, rect.t, vex), ground(rect.r, rect.t, vex), ground(rect.r, rect.b, vex), ground(rect.l, rect.b, vex)];
    state.view = corners.every(Boolean) ? /** @type {Point[]} */ (corners) : null;
    const byKey = new Map(drawn.map((o) => [o.key, o]));
    /** Every unit and the base: where it is (true, scene m) and on screen. */
    /** @type {{id: string, name: string, kind: string, at: Point, s: Point | undefined, status: string | undefined, mock?: boolean}[]} */
    const items = units.map((u) => {
      const m = u.members[0], o = byKey.get(`${u.kind === "vehicle" ? "asset" : "drone"}:${m.id}`);
      const statuses = u.members.map((mm) => byKey.get(`drone:${mm.id}`)?.status).filter((s) => !!s);
      const status = statuses.sort((a, b) => STATUS_RANK[/** @type {"idle"} */ (a)] - STATUS_RANK[/** @type {"idle"} */ (b)])[0];
      return { id: u.id, name: unitName(u), kind: u.kind, at: /** @type {Point} */ ([m.x, m.z]), s: o && /** @type {Point} */ ([o.sx, o.sy]),
        status, mock: mockGroup(u) };
    });
    if (base) items.unshift({ id: "base", name: "Base", kind: "base", at: base, s: screen(base[0], groundAt(base[0], base[1]) * vex, base[1]), status: undefined });

    // edge tabs: anything off the map area, from the view's centre. Built once; the arrow and the km
    // change in place, the size is measured again only when the name or status changes.
    const centre = ground((rect.l + rect.r) / 2, (rect.t + rect.b) / 2, vex);
    const placed = [];
    for (const i of items) {
      const t = i.s && edgeTab(rect, i.s[0], i.s[1], 8);
      let tab = tabs.get(i.id);
      if (!t || !centre) { if (tab) tab.el.hidden = true; continue; }
      if (!tab) {
        const el = document.createElement("div"), id = i.id;
        el.className = "offs";
        el.innerHTML = `<svg width="12" height="12" viewBox="-6 -6 12 12"><path d="M-3 -4 L4 0 L-3 4"/></svg>` +
          `<span class="sw2"></span><span class="nm"></span><span class="dot"></span><span class="km"></span>`;
        el.onclick = () => go(id);
        layer.appendChild(el);
        tab = { el, arrow: /** @type {SVGElement} */ (el.firstElementChild), km: /** @type {HTMLElement} */ (el.lastElementChild), key: "", w: 90, h: 26 };
        tabs.set(i.id, tab);
      }
      const { el } = tab;
      el.hidden = false;
      const key = `${i.name}|${i.status}`;
      if (tab.key !== key) {
        tab.key = key;
        const [sw, nm, dot] = /** @type {HTMLElement[]} */ ([...el.children].slice(1, 4));
        sw.style.background = i.kind === "base" ? "#16181d" : i.kind === "vehicle" ? COLOURS.hostile : COLOURS.friendly;
        nm.textContent = i.name;
        nm.classList.toggle("mock", !!i.mock); // a group's name (a cluster)
        nm.title = i.mock ? MOCK.groups : "";
        dot.className = `dot ${i.status || ""}`;
        dot.style.display = i.status ? "" : "none";
        el.classList.toggle("critical", i.status === "critical");
        tab.w = el.offsetWidth;
        tab.h = el.offsetHeight;
      }
      const turn = `rotate(${Math.round((t.angle * 180) / Math.PI)}deg)`, km = `${(Math.hypot(i.at[0] - centre[0], i.at[1] - centre[1]) / 1000).toFixed(1)} km`;
      if (tab.arrow.style.transform !== turn) tab.arrow.style.transform = turn;
      if (tab.km.textContent !== km) tab.km.textContent = km;
      placed.push({ el, x: t.x, y: t.y, w: tab.w, h: tab.h });
    }
    for (const [id, tab] of tabs) if (!items.some((i) => i.id === id)) { tab.el.remove(); tabs.delete(id); }
    stackTabs(placed, rect, 4).forEach(([x, y], k) => {
      placed[k].el.style.left = `${f1(x)}px`;
      placed[k].el.style.top = `${f1(y)}px`;
    });
  }

  /** The base preset for view.js, null while World.origin is unknown. @param {(zoom: number) => number} vexFor */
  function basePose(vexFor) {
    const b = state.base;
    return b && { target: /** @type {[number, number, number]} */ ([b[0], groundAt(b[0], b[1]) * vexFor(BASE_ZOOM), b[1]]), zoom: BASE_ZOOM };
  }

  return { state, update, basePose };
}
