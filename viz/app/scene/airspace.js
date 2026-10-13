// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Airspace, range rings and the base. From GeocageService.geocage (swarm.bus/geocage,
// a partner component, when it runs) and World.airspace (config/world.yaml): the geocage
// as a dashed line with a soft band inside it, each no-fly zone as a hatched red footprint, a faint
// wall and a label. Range rings every 10 km round the base (World.origin) at wide zoom; the base as a
// dark diamond. Footprints and rings lie on the terrain as drawn, in the #air SVG under the labels
// (rebuilt only when the camera or the data moved); the walls are meshes. A zone is lateral only (the
// airspace monitor ignores altitude inside it): its wall is symbolic, up to the geocage ceiling but no
// taller than the zone is wide, so a small zone stays a block, not a needle.
// The service's geocage is SEN data, drawn with the "Airspace" layer; the file's geocage (without the
// service), its zones and the rings are mock-up (model/provenance.js): drawn only with the "Mock-up
// data" layer on too, their labels in the mock style.
import * as THREE from "three";
import { geoToLocal, demHeight } from "../model/geo.js";
import { geocage, noFlyZones, sstep, f1, esc } from "../model/distance.js";
import { shown } from "../model/provenance.js";

/** @typedef {import("../model/store.js").Store} Store */
/** @typedef {import("./overlays.js").OverlayLabel} OverlayLabel */
/** @typedef {[number, number]} Point */
/** @typedef {{x: number, h: number, z: number} | null} Sample  on the ground, true metres; null = a break */

const RING_KM = 10;
const MAX_SAMPLES = 400;                 // per draped line
const DEFAULT_CEILING = 1000;            // m above the base, when the airspace has no altitude band
const RED = "#c64a41";

/**
 * @param {THREE.Scene} scene
 * @param {import("../model/geo.js").Dem} dem @param {import("../model/geo.js").LatLon} origin the scene's origin
 */
export function createAirspace(scene, dem, origin) {
  const g = /** @type {Element} */ (document.querySelector("#air g"));
  const walls = new THREE.Group();
  scene.add(walls);
  const wallMaterial = new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.11, side: THREE.DoubleSide, depthWrite: false });
  const capMaterial = new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: "#b6423a", transparent: true, opacity: 0.65 });
  const ground = (/** @type {number} */ x, /** @type {number} */ z) => demHeight(dem, x, z);
  const onDem = (/** @type {number} */ x, /** @type {number} */ z) => x >= dem.x0 && x <= dem.x1 && z >= dem.z0 && z <= dem.z1;
  /** @type {unknown[]} */
  let inputs = [];
  /** @type {{base: Point | null, cage: Sample[], live: boolean, band: string, rings: {km: number, line: Sample[]}[],
   *          zones: {name: string, line: Sample[], top: Point & {h: number}, meshes: THREE.Object3D[]}[]}} */
  let data = { base: null, cage: [], live: false, band: "", rings: [], zones: [] };
  let shownKey = "", svgShown = "";
  const v = new THREE.Vector3();

  /** A closed polygon densified on the ground. @param {Point[]} poly @returns {Sample[]} */
  function drape(poly) {
    const edges = poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);
    const length = edges.reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
    const step = Math.max(length / MAX_SAMPLES, 30);
    /** @type {Sample[]} */
    const out = [];
    for (const [a, b] of edges) {
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let k = 0; k < n; k++) {
        const x = a[0] + ((b[0] - a[0]) * k) / n, z = a[1] + ((b[1] - a[1]) * k) / n;
        out.push({ x, h: ground(x, z), z });
      }
    }
    out.push(out[0]);
    return out;
  }

  /** Rebuild from the data (World.origin, World.airspace, GeocageService.geocage). @param {Store} store */
  function rebuild(store) {
    const w = store.world, air = w.airspace, cageOf = geocage(store.geocage, air);
    const local = (/** @type {{latitude: number, longitude: number}} */ p) => {
      const l = geoToLocal(origin, p.latitude, p.longitude);
      return /** @type {Point} */ ([l.x, l.z]);
    };
    const base = w.origin ? local(w.origin) : null;
    const baseH = base ? ground(base[0], base[1]) : 0;
    const band = cageOf && cageOf.maxAltitude > cageOf.minAltitude ? `${Math.round(cageOf.minAltitude)}–${Math.round(cageOf.maxAltitude)} m` : "";
    const ceiling = baseH + (band && cageOf ? cageOf.maxAltitude : DEFAULT_CEILING);
    for (const m of [...walls.children]) { walls.remove(m); /** @type {THREE.Mesh} */ (m).geometry.dispose(); }
    const zones = [...noFlyZones(air)].map(([name, vertices]) => {
      const poly = vertices.map(local);
      const hs = poly.map(([x, z]) => ground(x, z)), low = Math.min(...hs) - 20, high = Math.max(...hs);
      let wide = 0;
      for (const a of poly) for (const b of poly) wide = Math.max(wide, Math.hypot(a[0] - b[0], a[1] - b[1]));
      const top = high + Math.max(0, Math.min(ceiling - high, wide));
      const wall = [], edges = [];
      for (let i = 0; i < poly.length; i++) {
        const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
        wall.push(ax, low, az, bx, low, bz, bx, top, bz, ax, low, az, bx, top, bz, ax, top, az);
        edges.push(ax, top, az, bx, top, bz);
        if (poly.length < 10 || i % 9 === 0) edges.push(ax, top, az, ax, hs[i], az); // the corners, or every 9th of a round zone
      }
      const wallGeometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(wall, 3));
      const capGeometry = new THREE.ShapeGeometry(new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z))))
        .rotateX(-Math.PI / 2).translate(0, top, 0);
      const edgeGeometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(edges, 3));
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      const meshes = [new THREE.Mesh(wallGeometry, wallMaterial), new THREE.Mesh(capGeometry, capMaterial), new THREE.LineSegments(edgeGeometry, edgeMaterial)];
      walls.add(...meshes);
      return { name, line: drape(poly), top: Object.assign(/** @type {Point} */ ([cx, cz]), { h: top }), meshes };
    });
    const rings = [];
    if (base) for (let km = RING_KM; ; km += RING_KM) {
      const R = km * 1000, line = [];
      for (let i = 0; i <= 240; i++) {
        const a = (i / 240) * 2 * Math.PI, x = base[0] + Math.cos(a) * R, z = base[1] + Math.sin(a) * R;
        line.push(onDem(x, z) ? { x, h: ground(x, z), z } : null);
      }
      if (!line.some(Boolean)) break;
      rings.push({ km, line });
    }
    const cage = cageOf ? drape(cageOf.vertices.map(local)) : [];
    data = { base, cage, live: !!cageOf?.live, band, rings, zones };
  }

  /**
   * One frame: the SVG when the view or the data changed, the walls' exaggeration, the labels.
   * @param {Store} store @param {THREE.OrthographicCamera} camera @param {number} vex
   * @param {import("../model/distance.js").Rect} rect the map area between the panels, px @returns {OverlayLabel[]}
   */
  function update(store, camera, vex, rect) {
    const next = [store.world.origin, store.world.airspace, store.geocage];
    if (next.some((x, i) => x !== inputs[i])) { inputs = next; rebuild(store); shownKey = ""; }
    const showAir = store.airspace && shown(store, "airspace"), showRings = store.rangeRings && shown(store, "rangeRings");
    const showCage = store.airspace && (data.live || showAir);
    walls.scale.y = vex;
    walls.visible = showAir;
    /** @param {number} x @param {number} y @param {number} z @returns {Point} */
    const screen = (x, y, z) => {
      v.set(x, y, z).project(camera);
      return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
    };
    /** @param {Sample[]} line an SVG path, broken at nulls */
    const path = (line) => {
      let d = "", pen = false;
      for (const s of line) {
        if (!s) { pen = false; continue; }
        const [x, y] = screen(s.x, s.h * vex, s.z);
        d += `${pen ? "L" : "M"}${f1(x)} ${f1(y)}`;
        pen = true;
      }
      return d;
    };
    const far = 1 - sstep(0.08, 0.3, camera.zoom); // range rings: wide zoom only
    /** @type {OverlayLabel[]} */
    const labels = [];
    const label = (/** @type {Omit<OverlayLabel, "px" | "lift">} */ l) => labels.push({ px: 0, lift: 4, ...l });
    const { base, cage, live, band, rings, zones } = data;
    const key = [...camera.projectionMatrix.elements, ...camera.matrixWorld.elements, vex, showAir, showCage, showRings].join();
    if (showCage && cage.length) { // the geocage's name and altitude band above its top-most point in the map area
      let top = null;
      for (const s of cage) {
        if (!s) continue;
        const p = screen(s.x, s.h * vex, s.z);
        if (p[0] > rect.l + 60 && p[0] < rect.r - 60 && p[1] > rect.t + 60 && p[1] < rect.b && (!top || p[1] < top[1])) top = p; // clear of the scale card
      }
      if (top) label({ key: "geocage", cls: live ? "tlab" : "tlab mock", html: `Geocage${band ? ` <span>· ${band}</span>` : ""}`, prio: 8, sx: top[0], sy: top[1] });
    }
    if (showAir) for (const z of zones) {
      const [x, y] = screen(z.top[0], z.top.h * vex, z.top[1]);
      label({ key: `nfz:${z.name}`, cls: "zlab mock", html: `NFZ ${esc(z.name)} <span>· all altitudes</span>`, prio: 6, sx: x, sy: y });
    }
    if (base) {
      const [x, y] = screen(base[0], ground(base[0], base[1]) * vex, base[1]);
      label({ key: "base", cls: "tlab strong", html: "Base", prio: 3, sx: x, sy: y + 16, pin: true });
    }
    if (key === shownKey) return labels;
    shownKey = key;
    let svg = "";
    if (showRings && far > 0.02) for (const r of rings)
      svg += `<path d="${path(r.line)}" class="ring" stroke-opacity="${(0.55 * far).toFixed(2)}"/>`;
    if (showCage && cage.length) {
      const d = path(cage);
      svg += `<clipPath id="cage-in"><path d="${d}"/></clipPath><path d="${d}" class="band" clip-path="url(#cage-in)"/><path d="${d}" class="cage"/>`;
    }
    if (showAir) for (const z of zones) svg += `<path d="${path(z.line)}Z" class="nfz"/>`;
    if (base) {
      const [x, y] = screen(base[0], ground(base[0], base[1]) * vex, base[1]);
      svg += `<rect x="${f1(x - 4.5)}" y="${f1(y - 4.5)}" width="9" height="9" class="base" transform="rotate(45 ${f1(x)} ${f1(y)})"/>`;
    }
    if (svg !== svgShown) g.innerHTML = svgShown = svg;
    return labels;
  }

  return { update };
}
