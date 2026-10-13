// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The area DEM as an architect's model: a CPU tile quadtree (65 x 65 vertices per tile, skirts,
// LRU cache) under one group whose scale.y is the vertical exaggeration, strata walls and a plinth
// round the slab, and a soft shadow on the floor below it. Plan §5.
import * as THREE from "three";
import { demHeight } from "../model/geo.js";
import { patchTerrain } from "./terrain_glsl.js";

/** @typedef {import("../model/geo.js").Dem} Dem */

const CELLS = 64;              // quads per tile side: 65 x 65 vertices
const ROOT_M = 10e3;           // level-0 tiles are ~10 km on a side
const MAX_LEVEL = 3;           // level-3 cells are ~20 m, just under the 30 m DEM spacing
const SPLIT_PX = 8;            // split a tile while one of its cells is wider than this on screen
const CACHE_TILES = 256;
const BUILDS_PER_FRAME = 4;    // until its children are built a tile draws itself: no hitches
export const BOTTOM = -600;    // slab bottom, metres (exaggerated with the rest)

const C = (/** @type {string} */ h) => new THREE.Color(h);
// the mockup's plaster palette
const PLASTER = C("#ece3d2"), HIGH = C("#f5efe4"), STONE = C("#dcc7a6"), VALLEY = C("#b6cd9c");
const SHORE = C("#d9dcc4"), SEA = C("#5f93c6"), SHORE_WATER = C("#a9cbe3"), WALL = C("#e0d4bf");
const sstep = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const _c = new THREE.Color();

/** Plaster, warmer and lighter high up, green in the valleys, stone on steep slopes (the sea is the shader's). */
function colorAt(/** @type {number} */ h, /** @type {number} */ slope) {
  _c.copy(PLASTER).lerp(HIGH, sstep(450, 700, h));
  _c.lerp(VALLEY, sstep(280, 60, h) * 0.6);
  _c.lerp(STONE, sstep(0.35, 0.9, slope) * 0.7);
  if (h < 12) _c.lerp(SHORE, 0.5);
  return _c;
}

/** @typedef {{cls: Uint8Array, width: number, height: number}} Landcover  one class per DEM sample, row 0 = north */

/**
 * Open cells within two cells of water whose 5 x 5 neighbourhood is mostly forest or farmland take
 * that class. OSM forest holes round lakes are often a little larger than the lakes, which rasterises
 * to a 30-60 m ring of open ground: a plaster halo round every forest pond.
 * @param {Uint8Array} src @param {number} w @param {number} h @returns {Uint8Array}
 */
function closeShoreGaps(src, w, h) {
  const out = src.slice();
  for (let r = 2; r < h - 2; r++) for (let c = 2; c < w - 2; c++) {
    if (src[r * w + c] !== 0) continue;
    const n = [0, 0, 0, 0];
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) n[src[(r + a) * w + c + b]]++;
    if (n[3] && n[1] + n[2] > n[0]) out[r * w + c] = n[1] >= n[2] ? 1 : 2;
  }
  return out;
}

/**
 * landcover.png (one class per DEM sample: 0 open, 1 forest, 2 farmland, 3 water) as a mipmapped
 * weights texture, r forest, g farmland, b water: filtering then blends class edges and thins out
 * ponds and streams smaller than a pixel instead of speckling.
 * @param {string} url @returns {Promise<{texture: THREE.DataTexture, landcover: Landcover}>}
 */
async function loadLandcover(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const { width, height } = bmp;
  const cx = /** @type {OffscreenCanvasRenderingContext2D} */ (new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true })); // CPU canvas: a GPU readback stalls ~15 s under software GL
  cx.drawImage(bmp, 0, 0);
  const rgba = cx.getImageData(0, 0, width, height).data, raw = new Uint8Array(width * height);
  for (let i = 0; i < raw.length; i++) raw[i] = rgba[4 * i];
  const cls = closeShoreGaps(raw, width, height), out = new Uint8Array(4 * cls.length);
  for (let i = 0; i < cls.length; i++) {
    const c = cls[i];
    out[4 * i] = c === 1 ? 255 : 0;
    out[4 * i + 1] = c === 2 ? 255 : 0;
    out[4 * i + 2] = c === 3 ? 255 : 0;
    out[4 * i + 3] = 255;
  }
  const texture = new THREE.DataTexture(out, width, height); // row 0 = north = v 0
  Object.assign(texture, { minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true });
  texture.needsUpdate = true;
  return { texture, landcover: { cls, width, height } };
}

/**
 * @param {Dem} dem
 * @param {string | null} landcover URL of the land-cover PNG aligned with `dem`, or null: plain plaster
 * @returns {{group: THREE.Group, floor: THREE.Mesh, top: number, landcover: Promise<Landcover | null>,
 *            surfaceAt: (x: number, z: number) => number,
 *            update: (camera: THREE.OrthographicCamera, vex: number) => void}}
 */
export function createTerrain(dem, landcover) {
  const uniforms = {
    uVex: { value: 1 }, uSea: { value: SEA }, uShore: { value: SHORE_WATER },
    uLand: { value: /** @type {THREE.Texture | null} */ (null) }, uLandOn: { value: 0 },
    uLandGrid: { value: new THREE.Vector4(dem.x0, dem.z0, dem.dx, dem.dz) },
  };
  const cover = !landcover ? Promise.resolve(null) : loadLandcover(landcover).then(({ texture, landcover: l }) => {
    uniforms.uLand.value = texture;
    uniforms.uLandOn.value = 1;
    return l;
  }, (e) => { console.warn(`land cover ${landcover}: ${e}; plain plaster`); return null; });
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = patchTerrain(uniforms);
  const group = new THREE.Group();
  let top = 0;
  for (const v of dem.data) top = Math.max(top, v);

  const rootsX = Math.max(1, Math.round((dem.x1 - dem.x0) / ROOT_M)), rootsZ = Math.max(1, Math.round((dem.z1 - dem.z0) / ROOT_M));
  const w0 = (dem.x1 - dem.x0) / rootsX, d0 = (dem.z1 - dem.z0) / rootsZ;

  function buildTile(/** @type {number} */ level, /** @type {number} */ i, /** @type {number} */ j) {
    const tw = w0 / 2 ** level, td = d0 / 2 ** level, cx = tw / CELLS, cz = td / CELLS;
    const tx = dem.x0 + i * tw, tz = dem.z0 + j * td;
    const N = CELLS + 1, n = N * N, skirt = Math.max(2 * cx, 50);
    const pos = new Float32Array((n + 4 * N) * 3), nor = new Float32Array(pos.length), col = new Float32Array(pos.length);
    const s = Math.max(cx, dem.spacing); // central-difference step
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const k = (r * N + c) * 3, x = tx + c * cx, z = tz + r * cz, h = demHeight(dem, x, z);
      const gx = (demHeight(dem, x + s, z) - demHeight(dem, x - s, z)) / (2 * s);
      const gz = (demHeight(dem, x, z + s) - demHeight(dem, x, z - s)) / (2 * s);
      const l = Math.hypot(gx, 1, gz);
      pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
      nor[k] = -gx / l; nor[k + 1] = 1 / l; nor[k + 2] = -gz / l;
      colorAt(h, Math.hypot(gx, gz)).toArray(col, k);
    }
    const idx = [];
    for (let r = 0; r < CELLS; r++) for (let c = 0; c < CELLS; c++) {
      const a = r * N + c;
      idx.push(a, a + N, a + 1, a + 1, a + N, a + N + 1);
    }
    // skirts: each edge copied `skirt` metres down, facing out, hiding cracks to coarser neighbours
    const edges = [(/** @type {number} */ q) => q, (q) => CELLS * N + q, (q) => q * N, (q) => q * N + CELLS];
    edges.forEach((edge, e) => {
      for (let q = 0; q < N; q++) {
        const src = edge(q) * 3, dst = (n + e * N + q) * 3;
        for (let t = 0; t < 3; t++) { pos[dst + t] = pos[src + t]; nor[dst + t] = nor[src + t]; col[dst + t] = col[src + t]; }
        pos[dst + 1] -= skirt;
        const [a, b, sa, sb] = [edge(q - 1), edge(q), n + e * N + q - 1, n + e * N + q];
        if (q) idx.push(...(e === 0 || e === 3 ? [a, b, sa, b, sb, sa] : [a, sa, b, b, sa, sb]));
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.userData.key = `${level}/${i}/${j}`;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    group.add(mesh);
    return mesh;
  }

  /** @type {Map<string, THREE.Mesh>} LRU: Map order = least recently used first */
  const cache = new Map();
  let budget = Infinity; // the first frame builds all it needs
  function tile(/** @type {number} */ level, /** @type {number} */ i, /** @type {number} */ j, force = false) {
    const key = `${level}/${i}/${j}`;
    let m = cache.get(key);
    if (m) cache.delete(key);
    else if (force || budget-- > 0) m = buildTile(level, i, j);
    else return null;
    cache.set(key, m);
    return m;
  }

  const frustum = new THREE.Frustum(), box = new THREE.Box3(), pv = new THREE.Matrix4();
  /** @type {THREE.Mesh[]} */ let shown = [];
  /** @type {Set<string>} the shown tiles' "level/i/j" */
  const shownKeys = new Set();
  let pxPerMetre = 1, vex = 1;
  function select(/** @type {number} */ level, /** @type {number} */ i, /** @type {number} */ j) {
    const tw = w0 / 2 ** level, td = d0 / 2 ** level, x = dem.x0 + i * tw, z = dem.z0 + j * td;
    box.min.set(Math.min(x, x + tw), BOTTOM * vex, Math.min(z, z + td));
    box.max.set(Math.max(x, x + tw), top * vex, Math.max(z, z + td));
    if (!frustum.intersectsBox(box)) return;
    if (level < MAX_LEVEL && (tw / CELLS) * pxPerMetre > SPLIT_PX) {
      const kids = [[0, 0], [1, 0], [0, 1], [1, 1]];
      if (kids.every(([a, b]) => tile(level + 1, 2 * i + a, 2 * j + b))) {
        for (const [a, b] of kids) select(level + 1, 2 * i + a, 2 * j + b);
        return;
      }
    }
    shown.push(/** @type {THREE.Mesh} */ (tile(level, i, j, true)));
  }

  // strata walls round the slab (the shader's STRATA) and a dark plinth under it
  {
    const pos = [], idx = [];
    const corners = [[dem.x0, dem.z0], [dem.x1, dem.z0], [dem.x1, dem.z1], [dem.x0, dem.z1], [dem.x0, dem.z0]];
    for (let e = 0; e < 4; e++) {
      const [ax, az] = corners[e], [bx, bz] = corners[e + 1];
      const k = (e % 2 ? rootsZ : rootsX) * CELLS, b0 = pos.length / 3; // the top follows the level-0 tiles' edge vertices
      for (let q = 0; q <= k; q++) {
        const x = ax + ((bx - ax) * q) / k, z = az + ((bz - az) * q) / k;
        pos.push(x, demHeight(dem, x, z), z, x, BOTTOM, z);
        if (q < k) { const a = b0 + 2 * q; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // pulled towards the camera: the walls share their plane with the outer skirts
    const wallMaterial = new THREE.MeshLambertMaterial({ color: WALL, polygonOffset: true,
      polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    wallMaterial.defines = { STRATA: "" };
    wallMaterial.onBeforeCompile = material.onBeforeCompile;
    group.add(new THREE.Mesh(g, wallMaterial));
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(dem.x1 - dem.x0 + 200, 80, dem.z1 - dem.z0 + 200),
      new THREE.MeshLambertMaterial({ color: "#3a3d43" }));
    plinth.position.set((dem.x0 + dem.x1) / 2, BOTTOM - 40, (dem.z0 + dem.z1) / 2);
    group.add(plinth);
  }

  // floor shadow: a radial gradient under the slab, offset away from the sun as in the mockup
  const floor = (() => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 256;
    const cx = /** @type {CanvasRenderingContext2D} */ (cv.getContext("2d"));
    const gr = cx.createRadialGradient(128, 128, 20, 128, 128, 128);
    gr.addColorStop(0, "rgba(20,24,30,.45)");
    gr.addColorStop(0.6, "rgba(20,24,30,.26)");
    gr.addColorStop(1, "rgba(20,24,30,0)");
    cx.fillStyle = gr;
    cx.fillRect(0, 0, 256, 256);
    const W = dem.x1 - dem.x0, D = dem.z1 - dem.z0;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.37, D * 1.4),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set((dem.x0 + dem.x1) / 2 + W * 0.037, 0, (dem.z0 + dem.z1) / 2 + D * 0.06);
    return m;
  })();

  function update(/** @type {THREE.OrthographicCamera} */ camera, /** @type {number} */ v) {
    vex = v;
    group.scale.y = uniforms.uVex.value = vex;
    floor.position.y = BOTTOM * vex - 300;
    pxPerMetre = camera.zoom;
    camera.updateMatrixWorld(); // controls.update() just moved it; render() would do this too late
    frustum.setFromProjectionMatrix(pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const m of shown) m.visible = false;
    shown = [];
    for (let j = 0; j < rootsZ; j++) for (let i = 0; i < rootsX; i++) select(0, i, j);
    budget = BUILDS_PER_FRAME;
    for (const m of shown) m.visible = true;
    shownKeys.clear();
    for (const m of shown) shownKeys.add(m.userData.key);
    for (const [key, m] of cache) {
      if (cache.size <= CACHE_TILES) break;
      if (m.visible) continue;
      group.remove(m);
      m.geometry.dispose();
      cache.delete(key);
    }
  }

  /**
   * The height (m, unexaggerated) of the surface as drawn at x/z: the shown tile's triangles, which on
   * a coarse tile can lie above or below the DEM; the DEM where no tile is shown (off screen).
   * @param {number} x @param {number} z @returns {number}
   */
  function surfaceAt(x, z) {
    for (let level = 0; level <= MAX_LEVEL; level++) {
      const tw = w0 / 2 ** level, td = d0 / 2 ** level;
      const i = Math.floor((x - dem.x0) / tw), j = Math.floor((z - dem.z0) / td);
      if (!shownKeys.has(`${level}/${i}/${j}`)) continue;
      const cx = tw / CELLS, cz = td / CELLS, tx = dem.x0 + i * tw, tz = dem.z0 + j * td;
      const u = (x - tx) / cx, v = (z - tz) / cz, c = Math.min(Math.floor(u), CELLS - 1), r = Math.min(Math.floor(v), CELLS - 1);
      const fu = u - c, fv = v - r, x0 = tx + c * cx, z0 = tz + r * cz;
      const h01 = demHeight(dem, x0 + cx, z0), h10 = demHeight(dem, x0, z0 + cz);
      if (fu + fv <= 1) { const h00 = demHeight(dem, x0, z0); return h00 + fu * (h01 - h00) + fv * (h10 - h00); }
      const h11 = demHeight(dem, x0 + cx, z0 + cz); // the tile's two triangles per cell: (a, a+N, a+1), (a+1, a+N, a+N+1)
      return h11 + (1 - fu) * (h10 - h11) + (1 - fv) * (h01 - h11);
    }
    return demHeight(dem, x, z);
  }

  return { group, floor, top, landcover: cover, update, surfaceAt };
}
