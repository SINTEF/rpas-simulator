// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Distance geometry for the HUD: how far a polygon reaches from the base, the
// distance strip's scale and label rows, the edge tabs for off-screen things; the HUD's small
// helpers (fade, SVG number, escape).
// Pure: no DOM, no three. Scene metres (x east, z south),
// screen px (x right, y down).

/** @typedef {[number, number]} Point */

/** Smoothstep of x between a and b (0..1): the HUD's fades. @param {number} a @param {number} b @param {number} x */
export const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** A number for SVG, one decimal. @param {number} v */
export const f1 = (v) => v.toFixed(1);
/** Text safe inside HTML / SVG markup. @param {string} s */
export const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
/** @typedef {{l: number, t: number, r: number, b: number}} Rect  screen px */

/**
 * The no-fly zones to show: the simulator's (World.airspace), one per name; polygons of 3
 * vertices or more.
 * @template {{latitude: number, longitude: number}} V
 * @param {{noFlyZones: {zoneName: string, vertices: V[]}[]} | undefined} airspace @returns {Map<string, V[]>}
 */
export function noFlyZones(airspace) {
  const out = new Map();
  for (const z of airspace?.noFlyZones || []) if (z.vertices.length >= 3) out.set(z.zoneName, z.vertices);
  return out;
}

/**
 * The geocage to show: the geocage service's (GeocageService.geocage, SEN data: `live`) when it has 3
 * vertices or more, else the simulator's (World.airspace, mock-up); null when neither has one.
 * @param {import("./types.js").Geocage | null} service @param {import("./types.js").Airspace | undefined} airspace
 * @returns {{vertices: {latitude: number, longitude: number}[], minAltitude: number, maxAltitude: number, live: boolean} | null}
 */
export function geocage(service, airspace) {
  if (service && service.vertices.length >= 3) return { ...service, live: true };
  if (airspace && airspace.geocage?.length >= 3) {
    return { vertices: airspace.geocage, minAltitude: airspace.minAltitude, maxAltitude: airspace.maxAltitude, live: false };
  }
  return null;
}

/** @param {Point} p @param {Point} a @param {Point} b distance from p to the segment a-b */
function toSegment(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz;
  const t = L ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

/** Is p inside the polygon (even-odd)? @param {Point} p @param {Point[]} poly */
export function insidePolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The nearest and farthest distance of a polygon from the base, m; nearest is 0 with the base inside.
 * @param {Point[]} poly @param {Point} base @returns {[number, number]}
 */
export function radialSpan(poly, base) {
  let near = Infinity, far = 0;
  for (let i = 0; i < poly.length; i++) {
    near = Math.min(near, toSegment(base, poly[i], poly[(i + 1) % poly.length]));
    far = Math.max(far, Math.hypot(poly[i][0] - base[0], poly[i][1] - base[1]));
  }
  return [insidePolygon(base, poly) ? 0 : near, far];
}

const STRIP_KM = [5, 10, 20, 50, 100, 200, 500];

/** The strip's full length, km: the first step with room for the farthest thing (5 % spare). @param {number} km */
export function stripLength(km) {
  return STRIP_KM.find((k) => k >= km * 1.05) ?? STRIP_KM[STRIP_KM.length - 1];
}

/** Ticks every tenth of the strip, every other one labelled. @param {number} length km @returns {{km: number, major: boolean}[]} */
export function stripTicks(length) {
  return Array.from({ length: 11 }, (_, i) => ({ km: (length * i) / 10, major: i % 2 === 0 }));
}

/**
 * Label rows on the strip, in the order given (most important first): above the line (0), below it
 * (1), or none (-1) where both rows are taken. x and width in px.
 * @param {{x: number, width: number}[]} labels @returns {number[]}
 */
export function stripRows(labels) {
  /** @type {[number, number][][]} taken spans per row */
  const rows = [[], []];
  return labels.map(({ x, width }) => {
    const a = x - width / 2 - 4, b = x + width / 2 + 4;
    const row = rows.findIndex((spans) => !spans.some(([s, e]) => a < e && b > s));
    if (row >= 0) rows[row].push([a, b]);
    return row;
  });
}

/**
 * Where the tab of an off-screen point sits: on the ray from the rect's centre towards it, `inset` px
 * inside the rect's edge; angle = the ray's direction (rad, screen). null = the point is in the rect.
 * @param {Rect} rect @param {number} x @param {number} y @param {number} inset
 * @returns {{x: number, y: number, angle: number} | null}
 */
export function edgeTab(rect, x, y, inset) {
  if (x >= rect.l && x <= rect.r && y >= rect.t && y <= rect.b) return null;
  const cx = (rect.l + rect.r) / 2, cy = (rect.t + rect.b) / 2, angle = Math.atan2(y - cy, x - cx);
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let t = Infinity;
  if (dx < 0) t = Math.min(t, (rect.l + inset - cx) / dx);
  if (dx > 0) t = Math.min(t, (rect.r - inset - cx) / dx);
  if (dy < 0) t = Math.min(t, (rect.t + inset - cy) / dy);
  if (dy > 0) t = Math.min(t, (rect.b - inset - cy) / dy);
  return { x: cx + dx * t, y: cy + dy * t, angle };
}

/**
 * Tabs as boxes centred on their edge points, kept inside the rect and off each other: pushed down
 * past what they overlap, or up when that would leave the rect. Returns each box's top-left, in the
 * order given.
 * @param {{x: number, y: number, w: number, h: number}[]} tabs @param {Rect} rect @param {number} gap
 * @returns {Point[]}
 */
export function stackTabs(tabs, rect, gap) {
  /** @type {number[][]} boxes [left, top, right, bottom] placed so far */
  const placed = [];
  const out = /** @type {Point[]} */ (tabs.map(() => [0, 0]));
  const order = tabs.map((_, i) => i).sort((i, j) => tabs[i].y - tabs[j].y);
  for (const i of order) {
    const { w, h } = tabs[i];
    const x = Math.min(Math.max(tabs[i].x - w / 2, rect.l), rect.r - w);
    const y0 = Math.min(Math.max(tabs[i].y - h / 2, rect.t), rect.b - h);
    const hit = (/** @type {number} */ y) => placed.find((p) => x < p[2] && x + w > p[0] && y < p[3] + gap && y + h + gap > p[1]);
    let y = y0, p;
    while ((p = hit(y)) && y <= rect.b - h) y = p[3] + gap;
    if (y > rect.b - h) for (y = y0; (p = hit(y)) && y >= rect.t; ) y = p[1] - gap - h;
    y = Math.min(Math.max(y, rect.t), rect.b - h);
    placed.push([x, y, x + w, y + h]);
    out[i] = [x, y];
  }
  return out;
}
