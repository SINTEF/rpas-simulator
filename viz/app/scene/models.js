// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The procedural models (plan §5), in the mockup's units (nose +x, up +y, right +z): each is a body
// part (the side's colour), an accent part (white or dark) and both merged (outline, x-ray, shadow).
// Low-poly on purpose: few segments, flat faces. A ground model is 1.04 long like the mockup's vehicle.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** @param {THREE.BufferGeometry[]} parts */
const merge = (parts) => /** @type {THREE.BufferGeometry} */ (mergeGeometries(parts.map((g) => {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute("uv");
  return n;
})));
/** @param {THREE.BufferGeometry[]} body @param {THREE.BufferGeometry[]} accent */
const model = (body, accent) => ({ body: merge(body), accent: merge(accent), all: merge([...body, ...accent]) });
/** A cylinder lying along z (a wheel, a road wheel) or, with `alongX`, along x (a barrel). */
const roller = (/** @type {number} */ r, /** @type {number} */ w, alongX = false, r2 = r) =>
  new THREE.CylinderGeometry(r2, r, w, 8).rotateX(alongX ? 0 : Math.PI / 2).rotateZ(alongX ? -Math.PI / 2 : 0);
/** A side profile (points in x/y) extruded across the width w, centred on z = 0. */
function profile(/** @type {number[][]} */ pts, /** @type {number} */ w) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false }).translate(0, 0, -w / 2);
}

export function fixedWing() {
  const wing = new THREE.Shape();
  wing.moveTo(0, -1.6); wing.lineTo(0.26, -1.6); wing.lineTo(0.46, 0); wing.lineTo(0.26, 1.6);
  wing.lineTo(0, 1.6); wing.lineTo(-0.06, 0); wing.closePath();
  const body = [new THREE.CapsuleGeometry(0.13, 1.5, 4, 12).rotateZ(Math.PI / 2),
    new THREE.ExtrudeGeometry(wing, { depth: 0.06, bevelEnabled: false }).rotateX(Math.PI / 2).translate(-0.22, 0.09, 0)];
  const accent = [new THREE.SphereGeometry(0.11, 10, 8).translate(0.72, -0.02, 0)];
  for (const s of [-1, 1]) {
    accent.push(new THREE.BoxGeometry(0.24, 0.07, 0.14).translate(0.03, 0.07, s * 1.55));
    body.push(new THREE.BoxGeometry(0.3, 0.04, 0.66).rotateX(s * 0.62).translate(-0.8, 0.22, s * 0.24));
  }
  return model(body, accent);
}

/** Hull with a sloped glacis on dark tracks under skirts, a turret set back, a long gun forward. */
export function tank() {
  const body = [
    profile([[-0.5, 0.12], [0.36, 0.12], [0.52, 0.24], [0.3, 0.34], [-0.5, 0.34]], 0.4),   // hull, glacis at the front
    profile([[-0.3, 0.34], [0.12, 0.34], [0.2, 0.42], [0.08, 0.52], [-0.3, 0.52]], 0.36)   // turret, set back
      .translate(-0.06, 0, 0),
    roller(0.045, 0.62, true, 0.036).translate(0.43, 0.44, 0),                             // gun
  ];
  const accent = [roller(0.06, 0.08, true).translate(0.76, 0.44, 0),                       // muzzle brake
    new THREE.CylinderGeometry(0.05, 0.05, 0.04, 8).translate(-0.2, 0.54, 0.1)];              // hatch
  for (const s of [-1, 1]) {
    body.push(new THREE.BoxGeometry(1.0, 0.06, 0.15).translate(0, 0.26, s * 0.27));        // skirt
    accent.push(new THREE.BoxGeometry(0.84, 0.2, 0.13).translate(0, 0.12, s * 0.27),       // track, round ends
      roller(0.1, 0.13).translate(0.42, 0.12, s * 0.27), roller(0.1, 0.13).translate(-0.42, 0.12, s * 0.27));
  }
  return model(body, accent);
}

/** Cab at the front, a covered cargo bed behind a gap, six wheels. */
export function truck() {
  const body = [
    new THREE.BoxGeometry(1.02, 0.08, 0.44).translate(0, 0.2, 0),                           // chassis
    profile([[0.2, 0.22], [0.5, 0.22], [0.52, 0.36], [0.44, 0.54], [0.2, 0.54]], 0.46),     // cab
    new THREE.BoxGeometry(0.66, 0.36, 0.5).translate(-0.17, 0.44, 0),                       // covered bed
  ];
  const accent = [profile([[0.46, 0.4], [0.515, 0.4], [0.462, 0.52], [0.44, 0.52]], 0.4)];  // windscreen
  for (const s of [-1, 1]) for (const x of [0.34, -0.12, -0.36]) accent.push(roller(0.1, 0.08).translate(x, 0.1, s * 0.22));
  return model(body, accent);
}

/** @param {string} c @param {number} glow */
export function vivid(c, glow) { return new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.05, emissive: c, emissiveIntensity: glow }); }
