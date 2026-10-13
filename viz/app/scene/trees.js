// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Small 3D trees on the forest cells of the land cover within RADIUS of the camera target: one
// InstancedMesh, refilled only when the target has moved RADIUS / 4, faded in close up. Added to the
// terrain group, so it shares its exaggeration. Positions are hashed per cell: a refill never
// reshuffles trees that stay.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { demHeight } from "../model/geo.js";

/** @typedef {import("../model/geo.js").Dem} Dem */
/** @typedef {import("./terrain.js").Landcover} Landcover */

const RADIUS = 1100;              // metres round the target
const PER_CELL = 3;               // trees per 30 m forest cell
const MAX = 16000;
const FADE = [0.45, 0.8];         // px per metre: invisible below, opaque above
const FOREST = 1;

/** A tree: a rounded green crown on a short brown trunk, 1 unit = 1 m, standing on y = 0. */
function tree() {
  const paint = (/** @type {THREE.BufferGeometry} */ g, /** @type {string} */ hex) => {
    const c = new THREE.Color(hex), n = g.attributes.position.count, col = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) c.toArray(col, 3 * i);
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  };
  const crown = paint(new THREE.IcosahedronGeometry(2.8, 0).scale(1, 1.3, 1).translate(0, 6, 0), "#82ad62");
  const trunk = paint(new THREE.CylinderGeometry(0.35, 0.35, 2.5, 5).translate(0, 1.25, 0).toNonIndexed(), "#6b5a45");
  return /** @type {THREE.BufferGeometry} */ (mergeGeometries([crown, trunk]));
}

/** A hash of (i, k) in [0, 1). */
const hash = (/** @type {number} */ i, /** @type {number} */ k) => {
  const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * @param {THREE.Group} parent the terrain group (scaled by the vertical exaggeration)
 * @param {Dem} dem @param {Promise<Landcover | null>} landcover one class per DEM sample
 * @returns {(target: THREE.Vector3, zoom: number) => void} per frame, with the controls' target
 */
export function createTrees(parent, dem, landcover) {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0 });
  const mesh = new THREE.InstancedMesh(tree(), material, MAX);
  mesh.count = 0;
  mesh.frustumCulled = false; // the instances move; the geometry's own sphere is one tree
  mesh.visible = false;
  parent.add(mesh);
  /** @type {Landcover | null} */ let cover = null;
  landcover.then((l) => { cover = l; });
  const at = new THREE.Vector2(Infinity, Infinity), m = new THREE.Matrix4(), q = new THREE.Quaternion();
  const p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();

  function fill(/** @type {number} */ x, /** @type {number} */ z) {
    const cls = /** @type {Landcover} */ (cover).cls, w = dem.width;
    const c0 = Math.max(0, Math.floor((x - RADIUS - dem.x0) / dem.dx)), c1 = Math.min(w - 1, Math.ceil((x + RADIUS - dem.x0) / dem.dx));
    const r0 = Math.max(0, Math.floor((z - RADIUS - dem.z0) / dem.dz)), r1 = Math.min(dem.height - 1, Math.ceil((z + RADIUS - dem.z0) / dem.dz));
    let n = 0;
    for (let r = r0; r <= r1; r++) for (let col = c0; col <= c1; col++) {
      const i = r * w + col;
      if (cls[i] !== FOREST) continue;
      const cx = dem.x0 + col * dem.dx, cz = dem.z0 + r * dem.dz;
      if (Math.hypot(cx - x, cz - z) > RADIUS) continue;
      for (let k = 0; k < PER_CELL && n < MAX; k++, n++) {
        p.set(cx + (hash(i, k) - 0.5) * dem.dx, 0, cz + (hash(i, k + 7) - 0.5) * dem.dz);
        p.y = demHeight(dem, p.x, p.z) - 0.5;
        s.setScalar(0.7 + 0.6 * hash(i, k + 13));
        mesh.setMatrixAt(n, m.compose(p, q.setFromAxisAngle(up, 6.3 * hash(i, k + 19)), s));
        mesh.setColorAt(n, c.setScalar(0.8 + 0.35 * hash(i, k + 23)));
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    at.set(x, z);
  }

  return (target, zoom) => {
    const t = Math.min(1, Math.max(0, (zoom - FADE[0]) / (FADE[1] - FADE[0])));
    mesh.visible = t > 0 && cover !== null;
    if (!mesh.visible) return;
    material.opacity = t;
    material.transparent = t < 1;
    if (Math.hypot(target.x - at.x, target.z - at.y) > RADIUS / 4) fill(target.x, target.z);
  };
}
