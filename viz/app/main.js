// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Boot the swarm view: area DEM -> terrain slab -> view; then the one rAF loop.
import { makeDem, demHeight, nearestLand, waterAt } from "./model/geo.js";
import { createView, vexFor } from "./scene/view.js";
import { createTerrain, BOTTOM } from "./scene/terrain.js";
import { createTrees } from "./scene/trees.js";
import { createStore } from "./model/store.js";
import { startFeed } from "./sen/feed.js";
import { createAircraft, COLOURS } from "./scene/aircraft.js";
import { createMinSize } from "./scene/minsize.js";
import { presetPose } from "./scene/overlays.js";
import { createUnits } from "./model/derive.js";
import { createLabels } from "./hud/labels.js";
import { createScale } from "./hud/scale.js";
import { createGround } from "./hud/ground.js";
import { createRoutes } from "./scene/routes.js";
import { createCommands, domToast } from "./sen/commands.js";
import { createUi } from "./ui/App.js";
import { createAirspace } from "./scene/airspace.js";
import { createScreen } from "./hud/screen.js";
import { shown } from "./model/provenance.js";

const json = async (/** @type {string} */ url) => (await fetch(url)).json();
// the simulator version for the top bar (serve.py /version: the tag, or sha1[-dirty])
const version = await fetch("version").then((r) => r.ok ? r.text() : "unknown", () => "unknown");

const [name] = (await json("data/index.json")).areas;
const sidecar = await json(`data/${name}/dem.json`);
const grid = sidecar.theatre; // the 60 x 40 km theatre grid
const data = new Int16Array(await (await fetch(`data/${name}/${grid.file}`)).arrayBuffer());
// dem.json's origin is the world origin it was fetched for (Step 2 reads World.origin from SEN)
const dem = makeDem(grid, data, { latitude: sidecar.originLat, longitude: sidecar.originLon });

const landcover = grid.landcover ? `data/${name}/${grid.landcover.file}` : null;
const terrain = createTerrain(dem, landcover);
/** @type {HTMLElement} */ (document.getElementById("credit")).textContent =
  [sidecar.demAttribution, landcover && "© OpenStreetMap contributors"].filter(Boolean).join(" · ");
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("gl"));
/** @type {import("./model/types.js").Unit[]} */
let units = [];
/** @type {import("./scene/aircraft.js").Drawn[]} */
let drawn = [];
const view = createView(canvas, {
  x0: dem.x0, x1: dem.x1, z0: dem.z0, z1: dem.z1, bottom: BOTTOM, top: terrain.top,
  groundAt: (x, z) => demHeight(dem, x, z),
}, (preset) => preset === "base" ? screen.basePose(vexFor) : presetPose(preset, units, drawn, vexFor(camera.zoom), vexFor, controls.maxZoom),
  () => screen.state.rect);
const { renderer, scene, camera, controls } = view;
scene.add(terrain.group, terrain.floor);
const trees = createTrees(terrain.group, dem, terrain.landcover);

// the live feed: scene metres are around the DEM's origin, drones are drawn by the flat-sim rule
const store = createStore();
const client = startFeed(store);
const sceneOrigin = { latitude: sidecar.originLat, longitude: sidecar.originLon };
/** @type {Uint8Array | null} */
let cover = null;
const screen = createScreen({ camera, controls, go: view.go, origin: sceneOrigin, groundAt: (x, z) => demHeight(dem, x, z) });
terrain.landcover.then((l) => { cover = l && l.cls; });
const aircraft = createAircraft(scene, { groundAt: (x, z) => demHeight(dem, x, z), surfaceAt: terrain.surfaceAt, origin: sceneOrigin,
  toLand: (x, z, cache) => nearestLand(dem, cover, x, z, cache), isWater: (x, z) => waterAt(dem, cover, x, z) });
const buildUnits = createUnits(), unitsOrigin = { ...sceneOrigin, altitude: 0 };
const minSize = createMinSize();
const airspace = createAirspace(scene, dem, sceneOrigin);
const labels = createLabels(canvas, store);
// the panels and the commands, through the feed's client (one client id per page)
const toast = domToast(/** @type {HTMLElement} */ (document.getElementById("toasts")));
const ui = createUi({ root: /** @type {HTMLElement} */ (document.getElementById("ui")), store, toast, view, screen: screen.state,
  commands: createCommands({ client, toast }),
  version, theatre: `${Math.round((dem.x1 - dem.x0) / 1000)} × ${Math.round((dem.z1 - dem.z0) / 1000)} km` });
Object.assign(ui.act, { follow: view.follow, following: view.following }); // the inspector's Follow
const ground = createGround({ canvas, camera, terrain: terrain.group, dem, origin: sceneOrigin, onClick: ui.act.ground });
const routes = createRoutes(scene, { groundAt: (x, z) => demHeight(dem, x, z), origin: sceneOrigin, colour: COLOURS.mock });
const scale = createScale(store);
let uiAt = -Infinity;

// ?fps: frames per second and the GPU string (software GL under WSLg shows up here)
const fpsBox = new URLSearchParams(location.search).has("fps") ? document.getElementById("fps") : null;
let gpu = "";
if (fpsBox) {
  const gl = renderer.getContext(), ext = gl.getExtension("WEBGL_debug_renderer_info");
  gpu = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
  fpsBox.hidden = false;
}
let frames = 0, since = performance.now();

function frame(/** @type {number} */ now) {
  requestAnimationFrame(frame);
  view.update(now);
  controls.update();
  const vex = vexFor(camera.zoom);
  terrain.update(camera, vex);
  trees(controls.target, camera.zoom);
  units = buildUnits(store.drones, store.assets, unitsOrigin, shown(store, "groups"));
  const layout = minSize(units, camera.zoom, store.minSize);
  drawn = aircraft.update(store, camera, vex, now, layout);
  const air = airspace.update(store, camera, vex, screen.state.rect);
  routes.update(ui.shownRoutes(), drawn, store.world.origin, camera, vex);
  renderer.render(scene, camera);
  labels.update(drawn, now, air);
  screen.update(units, drawn, store, vex, now);
  scale(camera, controls.target, vex);
  ground.update(drawn, vex, ui.ui.draft, ui.ui.pending, now);
  if (now - uiAt > 200) { uiAt = now; ui.render(units); }
  if (fpsBox && ++frames && now - since > 500) {
    fpsBox.textContent = `${Math.round((frames * 1000) / (now - since))} fps · ${gpu}`;
    frames = 0;
    since = now;
  }
}
requestAnimationFrame(frame);
