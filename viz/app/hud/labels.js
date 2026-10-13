// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The HUD over the 3D view (plan §5): pooled DOM pills placed greedily by priority (selected >
// critical > caution > drone > ground; a pill with no free spot is hidden) with a leader
// line, the hostile ◇ frame, the hover tooltip, and click / hover by screen-space picking. Pill and
// tooltip content refresh at most 5 times a second, positions every frame. The overlays' labels
// (airspace names) join the same placement; a pinned one sits where it is asked.
import { pick, COLOURS } from "../scene/aircraft.js";
import { label } from "../model/enums.js";

/** @typedef {import("../scene/aircraft.js").Drawn} Drawn */
/** @typedef {import("../model/store.js").Store} Store */
/** @typedef {import("../model/types.js").Drone} Drone */
/** @typedef {import("../scene/overlays.js").OverlayLabel} OverlayLabel */

const CONTENT_MS = 200;
const TOP = 48; // the top bar
const PRIO = { critical: 2, caution: 3, nominal: 5, idle: 5 };
// candidate offsets from the preferred spot, tried in order
const OFFSETS = [[0, 0], [0, -20], [0, 20], [1, 0], [-1, 0], [0, -40], [1, -20], [-1, -20], [0, 40], [0, -60]];

/** @param {string} s */
const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
/** @param {number | undefined} v @param {number} [digits] */
const num = (v, digits = 0) => (v === undefined ? "–" : v.toFixed(digits));

/** The word the tooltip shows: the alert reason, else the flight mode. */
function stateWord(/** @type {Drone} */ d, /** @type {Drawn} */ o) {
  if (o.reason) return o.reason;
  return label("FlightMode", d.link.mode ?? d.truth.mode);
}


/**
 * A compact pill: a vehicle's mark and name; a drone's colour bar, status dot, name and altitude (its
 * state word is in the tooltip and the inspector).
 * @param {Drawn} o @param {Store} store
 * @returns {{cls: string, html: string, prio: number} | null}
 */
function pillOf(o, store) {
  if (o.kind === "asset") {
    return { cls: "pill hos", prio: 6, html: `<i class="hsym"></i>${esc(o.id)}` };
  }
  const d = store.drones.get(o.id);
  if (!d || !o.status) return null;
  const sel = store.selectedId === o.id;
  return {
    cls: `pill ${o.status}${sel ? " sel" : ""}`, prio: sel ? 1 : PRIO[o.status],
    html: `<span class="sw2" style="background:${COLOURS.friendly}"></span><span class="dot ${o.status}"></span>drone${esc(o.id)}` +
      `<span class="n num">${num(d.truth.position?.altitude)} m</span>`,
  };
}

/** @param {Drawn} o @param {Store} store */
function tooltipOf(o, store) {
  if (o.kind === "asset") {
    const a = store.assets.get(o.id), type = a ? label("AssetType", a.assetType) : "";
    return `<div class="t1"><i class="hsym"></i><b>${esc(o.id)}</b><span>Hostile · ${type}</span></div>` +
      `<div class="g3 num"><div><span class="cap">Hdg</span><b>${num(a?.heading)}°</b></div></div>`;
  }
  const d = store.drones.get(o.id);
  if (!d) return "";
  const s = d.truth, battery = d.link.battery ?? s.battery;
  return `<div class="t1"><span class="sw2" style="background:${COLOURS.friendly}"></span><span class="dot ${o.status}"></span>` +
    `<b>drone${esc(o.id)}</b><span>${esc(stateWord(d, o))}</span></div>` +
    (o.reason && o.status !== "idle" ? `<div class="wb ${o.status}"><span class="dot ${o.status}"></span>${esc(o.reason)}</div>` : "") +
    `<div class="g3 num"><div><span class="cap">Hdg</span><b>${num(s.heading)}°</b></div>` +
    `<div><span class="cap">Speed</span><b>${num(s.groundSpeed, 1)}</b></div>` +
    `<div><span class="cap">AGL</span><b>${num(s.position?.altitude)}</b></div>` +
    `<div><span class="cap">Batt</span><b>${battery === undefined ? "–" : Math.round(battery * 100)} %</b></div></div>` +
    `<div class="ft"><span>${esc(label("FlightMode", d.link.mode ?? s.mode))}</span>` +
    `<span><span class="kb">Click</span></span></div>`;
}

/**
 * @param {HTMLCanvasElement} canvas the 3D view: hover and click on it pick objects
 * @param {Store} store
 */
export function createLabels(canvas, store) {
  const layer = /** @type {HTMLElement} */ (document.getElementById("labels"));
  const svg = /** @type {Element} */ (document.getElementById("ov"));
  const tip = /** @type {HTMLElement} */ (document.getElementById("tip"));
  /** @type {Map<string, HTMLElement & {_html?: string, _w?: number, _h?: number, _used?: boolean, _off?: number}>} */
  const pool = new Map();
  /** @type {Map<string, {cls: string, html: string, prio: number} | null>} */
  let content = new Map();
  let tipHtml = "", contentAt = -Infinity;
  /** @type {Drawn[]} */
  let drawn = [];
  document.fonts.ready.then(() => { for (const e of pool.values()) e._html = ""; }); // re-measure in the real font

  canvas.addEventListener("pointermove", (e) => {
    const o = pick(drawn, e.clientX, e.clientY);
    const key = o ? o.key : null;
    if (key !== store.hoverId) { store.hoverId = key; contentAt = -Infinity; }
    canvas.style.cursor = o ? "pointer" : "";
  });
  /** @type {[number, number] | null} */
  let downAt = null;
  canvas.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
  canvas.addEventListener("pointerup", (e) => {
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 4) {
      const o = pick(drawn, e.clientX, e.clientY);
      if (o && o.kind === "drone") store.selectedId = o.id;
      contentAt = -Infinity;
    }
    downAt = null;
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape") { store.selectedId = null; contentAt = -Infinity; } });

  /** @param {string} key @param {{cls: string, html: string}} c */
  function element(key, c) {
    let e = pool.get(key);
    if (!e) { e = document.createElement("div"); e.dataset.key = key; layer.appendChild(e); pool.set(key, e); }
    if (e._html !== c.html || e.className !== c.cls) {
      e.className = c.cls;
      e.innerHTML = c.html;
      e._html = c.html;
      e.style.display = "";
      e._w = e.offsetWidth;
      e._h = e.offsetHeight;
    }
    e.style.display = "";
    e._used = true;
    return e;
  }

  /**
   * One frame.
   * @param {Drawn[]} objects what aircraft.update() drew @param {number} now ms
   * @param {OverlayLabel[]} extra the overlays' labels (scene/airspace.js)
   */
  function update(objects, now, extra) {
    drawn = objects;
    if (now - contentAt >= CONTENT_MS) {
      contentAt = now;
      content = new Map(objects.map((o) => [o.key, pillOf(o, store)]));
      const hovered = objects.find((o) => o.key === store.hoverId);
      tipHtml = hovered ? tooltipOf(hovered, store) : "";
    }
    for (const e of pool.values()) e._used = false;
    const W = innerWidth, H = innerHeight;
    /** @type {number[][]} pills placed so far, and every object's own footprint: pills do not cover models */
    const placed = objects.map((o) => { const r = Math.max(6, o.px * 0.45); return [o.sx - r, o.sy - r, o.sx + r, o.sy + r]; });
    let lines = "", frames = "";
    /** @type {(OverlayLabel & {kind?: string})[]} */
    const requests = [];
    for (const o of objects) {
      const c = content.get(o.key);
      if (c) requests.push({ ...c, key: o.key, kind: o.kind, sx: o.sx, sy: o.sy, px: o.px,
        lift: Math.max(o.px * 0.5, o.kind === "asset" ? 12 : 0) + 6 }); // just above the object (and its ◇)
    }
    requests.push(...extra);
    requests.sort((a, b) => a.prio - b.prio);
    for (const o of requests) {
      const op = o.opacity ?? 1;
      if (op < 0.02 || o.sx < -50 || o.sx > W + 50 || o.sy < TOP - 30 || o.sy > H + 30) continue;
      if (o.kind === "asset") { // the hostile ◇ frame
        const r = Math.max(14, o.px * 0.9);
        frames += `M${o.sx} ${o.sy - r * 0.62}L${o.sx + r} ${o.sy}L${o.sx} ${o.sy + r * 0.62}L${o.sx - r} ${o.sy}Z`;
      }
      const e = element(o.key, o);
      const w = e._w || 70, h = e._h || 16;
      e.style.opacity = op < 1 ? op.toFixed(2) : "";
      if (o.pin) {
        e.style.left = `${(o.sx - w / 2).toFixed(1)}px`;
        e.style.top = `${(o.sy - h / 2).toFixed(1)}px`;
        placed.push([o.sx - w / 2, o.sy - h / 2, o.sx + w / 2, o.sy + h / 2]);
        continue;
      }
      // last frame's spot first (no flicker between equal spots), then the others; no free spot: hidden
      let at = null;
      for (const k of [e._off ?? 0, ...OFFSETS.keys()]) {
        const [ox, oy] = OFFSETS[k];
        const x0 = Math.min(Math.max(o.sx - w / 2 + ox * (w / 2 + 12), 4), W - w - 4);
        const y0 = Math.max(o.sy - o.lift - h + oy, TOP + 4);
        const box = [x0 - 3, y0 - 3, x0 + w + 3, y0 + h + 3];
        if (!placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) {
          placed.push(box);
          at = [x0, y0];
          e._off = k;
          break;
        }
      }
      if (!at) { e._used = false; continue; }
      e.style.left = `${at[0].toFixed(1)}px`;
      e.style.top = `${at[1].toFixed(1)}px`;
      const ax = o.sx, ay = o.sy - o.px * 0.3;
      lines += `<path d="M${ax.toFixed(1)} ${ay.toFixed(1)}L${(at[0] + w / 2).toFixed(1)} ${(at[1] + h).toFixed(1)}" ` +
        `stroke-opacity="${(0.55 * op).toFixed(2)}"/>`;
    }
    for (const e of pool.values()) if (!e._used) e.style.display = "none";
    svg.innerHTML =
      `<path d="${frames}" fill="${COLOURS.hostile}" fill-opacity=".07" stroke="${COLOURS.hostile}" stroke-width="1.5"/>` +
      `<g fill="none" stroke="#16181d" stroke-width=".8">${lines}</g>`;

    const hovered = tipHtml && objects.find((o) => o.key === store.hoverId);
    tip.hidden = !hovered;
    if (hovered) {
      if (tip.dataset.html !== tipHtml) { tip.innerHTML = tipHtml; tip.dataset.html = tipHtml; }
      let x = hovered.sx - tip.offsetWidth - 28;
      if (x < 8) x = hovered.sx + 30;
      tip.style.left = `${x}px`;
      tip.style.top = `${Math.min(hovered.sy + 26, H - tip.offsetHeight - 8)}px`;
    }
  }

  return { update };
}
