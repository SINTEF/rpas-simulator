// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The panels as one Preact tree over the 3D view, and the UI state they share: the
// click mode (add waypoint, spawn), the draft route, pending spawns, the routes sent. The store is re-read on every render: main.js renders at most 5 times a
// second, a user action at once. Commands go through sen/commands.js only.
import { html, render } from "preact-htm";
import { TopBar } from "./TopBar.js";
import { Fleet } from "./Fleet.js";
import { Inspector } from "./Inspector.js";
import { Dock } from "./Dock.js";
import { DistanceStrip } from "./DistanceStrip.js";
import { droneInfo } from "../model/fleet.js";
import { applicable, waypointAt } from "../sen/commands.js";
import { ordinal } from "../model/enums.js";
import { clockWentBack } from "../model/derive.js";
import { shown } from "../model/provenance.js";
import { rememberedMock } from "./Layers.js";

/** @typedef {import("../model/store.js").Store} Store */
/** @typedef {import("../model/types.js").Unit} Unit */
/** @typedef {import("../model/types.js").GeoPosition} GeoPosition */
/** @typedef {import("../model/fleet.js").DroneInfo} DroneInfo */
/** @typedef {ReturnType<typeof import("../sen/commands.js").createCommands>} Commands */
/** @typedef {{latitude: number, longitude: number, t0: number, id: string | null, failed: boolean}} Pending  a spawn on its way */
/**
 * @typedef {Object} UiState
 * @property {"waypoint" | "spawn" | null} mode what a click on the map does
 * @property {GeoPosition[]} draft             the draft route, for the selected drone
 * @property {Pending[]} pending
 * @property {number | null} scaleDraft        the time-scale slider while dragged
 * @property {string | null} lastSelected
 * @property {Map<string, SentRoute>} routes    by drone id: what this page sent (SEN shows it only on the drone bus)
 * @property {boolean} resetting                a Reset simulation is running (serve.py /reset)
 * @property {number | undefined} lastSimTime   World.simTime at the last render: backwards = a restarted world
 */
/** A route as sent from this page (setRoute), kept while its drone is there. @typedef {{waypoints: GeoPosition[]}} SentRoute */
/** @typedef {{name: string, ids: string[]}} Target  what the dock commands: the selected drone */
/**
 * What every panel gets.
 * @typedef {Object} App
 * @property {Store} store
 * @property {UiState} ui
 * @property {Unit[]} units
 * @property {Map<string, DroneInfo>} info
 * @property {Target | null} target
 * @property {string} theatre                  "60 × 40 km"
 * @property {string} version                  the simulator version (serve.py /version)
 * @property {import("../hud/screen.js").ScreenState} screen  base, view footprint (hud/screen.js)
 * @property {Record<string, any>} act
 */

const SPAWN_TIMEOUT_MS = 30000; // discovery takes ~1–2 s; 30 s covers a cold image start

/**
 * @param {{root: HTMLElement, store: Store, commands: Commands, theatre: string, version: string,
 *          screen: import("../hud/screen.js").ScreenState,
 *          toast: (text: string, bad: boolean) => void,
 *          view: {camera: import("three").OrthographicCamera, controls: {minZoom: number, maxZoom: number},
 *                 go: (name: string) => void}}} options
 */
export function createUi({ root, store, commands, theatre, version, screen, toast, view }) {
  /** @type {UiState} */
  const ui = { mode: null, draft: [], pending: [], scaleDraft: null, lastSelected: null,
               routes: new Map(), resetting: false, lastSimTime: undefined };
  store.mock = rememberedMock();
  /** @type {Unit[]} */
  let units = [];
  /** @type {App} */
  let app;
  const refresh = () => draw(units);
  const ids = () => (app.target ? app.target.ids : []);
  /** What is selected: an answer that arrives after it changed must not empty the new draft. */
  const selection = () => store.selectedId;
  let zoomRun = 0;
  /** The drone a route goes to: the selected drone. */
  const drone = () => (app.target ? store.drones.get(app.target.ids[0]) : undefined);
  /** @type {string | null} the click mode when the last single click came: a double-click belongs to it */
  let clickMode = null;
  const ARRIVED = ordinal("NavigatorStatus", "arrived");

  /**
   * Send a route (Send, double-click) and remember it for the map; the draft is emptied only when it
   * was the draft that was sent and the selection is unchanged.
   * @param {string} id @param {GeoPosition[]} waypoints @param {boolean} fromDraft
   */
  async function sendWaypoints(id, waypoints, fromDraft) {
    const was = selection(), sent = waypoints.slice(), r = await commands.sendRoute(id, sent);
    if (r.ok) ui.routes.set(id, { waypoints: sent });
    if (r.ok && fromDraft && selection() === was) ui.draft.length = 0;
    refresh();
  }

  /** A spawn: a pending mark at once, named when serve.py answers, red if its drone never shows up. */
  async function spawn(/** @type {number} */ latitude, /** @type {number} */ longitude) {
    /** @type {Pending} */
    const p = { latitude, longitude, t0: performance.now(), id: null, failed: false };
    ui.pending.push(p);
    const drop = () => { ui.pending = ui.pending.filter((q) => q !== p); };
    p.id = await commands.spawn(latitude, longitude);
    if (!p.id) { drop(); return; }
    setTimeout(() => {
      if (!ui.pending.includes(p)) return;
      p.failed = true;
      toast(`drone${p.id} not on the buses after ${SPAWN_TIMEOUT_MS / 1000} s (discovery?)`, true);
      setTimeout(drop, SPAWN_TIMEOUT_MS);
    }, SPAWN_TIMEOUT_MS);
  }

  const act = {
    refresh,
    /** @param {string} name */ fly: (name) => view.go(name),
    /** @param {string} id */ select(id) { store.selectedId = id; refresh(); },
    deselect() { store.selectedId = null; refresh(); },
    /** @param {number} f */
    zoom(f) {
      const { camera, controls } = view, z0 = camera.zoom, t0 = performance.now(), run = ++zoomRun;
      const z1 = Math.min(controls.maxZoom, Math.max(controls.minZoom, z0 * f));
      const step = (/** @type {number} */ now) => {
        if (run !== zoomRun) return; // a newer zoom took over
        const t = Math.min(1, (now - t0) / 300);
        camera.zoom = z0 * (z1 / z0) ** t;
        camera.updateProjectionMatrix();
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    /** @param {"waypoint" | "spawn"} mode */ setMode(mode) { ui.mode = ui.mode === mode ? null : mode; refresh(); },
    /** A per-drone command, to the selected drone when it applies. @param {string} method */
    run: (method) => commands[/** @type {"arm"} */ (method)](ids().filter((id) => applicable(method, store.drones.get(id)))),
    remove() {
      const list = ids();
      if (list.length && confirm(`Remove ${list.map((id) => `drone${id}`).join(", ")} from the sim?`)) commands.remove(list);
    },
    /** Reset simulation: every tab clears its page memory when the clock goes back (draw). */
    async reset() {
      if (ui.resetting || !confirm("Reset simulation? Every drone is removed, the initial ones start again at the base, "
                                   + "the clock goes back to 0.")) return;
      ui.resetting = true; refresh();
      await commands.reset();
      ui.resetting = false; refresh();
    },
    sendRoute: () => sendWaypoints(ids()[0], ui.draft, true),
    /** Clear: the draft and the route shown for the drone. */
    clearDraft() { ui.draft.length = 0; ui.routes.delete(ids()[0]); refresh(); },
    togglePause: () => commands.togglePause(!!store.world.paused),
    /** @param {number} v */ scaleDraft(v) { ui.scaleDraft = v; refresh(); },
    /** @param {number} v */ async setTimeScale(v) { await commands.setTimeScale(v); ui.scaleDraft = null; refresh(); },
    /**
     * A click on the terrain (hud/ground.js): spawn there, shift = go there now, else a draft waypoint.
     * A double-click sends: in Add WP mode the draft (its first click added the last waypoint),
     * otherwise a one-waypoint route to that point.
     * @param {number} latitude @param {number} longitude @param {boolean} shift @param {boolean} double
     */
    ground(latitude, longitude, shift, double) {
      const d = drone(), groundAltitude = store.world.origin?.altitude ?? 0;
      if (double) {
        if (!shift && clickMode !== "spawn" && d && applicable("sendRoute", d, 1)) {
          if (clickMode === "waypoint") { if (ui.draft.length) sendWaypoints(d.id, ui.draft, true); }
          else sendWaypoints(d.id, [waypointAt(latitude, longitude, d, groundAltitude)], false);
        }
        return refresh();
      }
      clickMode = ui.mode;
      if (ui.mode === "spawn") { ui.mode = null; spawn(latitude, longitude); }
      else if (shift && d && applicable("goTo", d)) commands.goTo(d.id, waypointAt(latitude, longitude, d, groundAltitude));
      else if (ui.mode === "waypoint" && d) ui.draft.push(waypointAt(latitude, longitude, d, groundAltitude));
      refresh();
    },
  };

  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    ui.mode = null; // hud/labels.js deselects the drone
    refresh();
  });

  /** @param {Unit[]} next */
  function draw(next) {
    units = next;
    if (clockWentBack(ui.lastSimTime, store.world.simTime)) { // a restarted world: forget the old run
      ui.routes.clear(); ui.draft.length = 0; ui.pending = [];
      store.selectedId = null; ui.mode = null;
    }
    ui.lastSimTime = store.world.simTime;
    if (store.selectedId !== ui.lastSelected) { // a draft belongs to the drone it was clicked for
      ui.draft.length = 0;
      ui.lastSelected = store.selectedId;
    }
    for (const rid of ui.routes.keys()) if (!store.drones.has(rid)) ui.routes.delete(rid); // a removed drone
    ui.pending = ui.pending.filter((p) => !(p.id && store.drones.get(p.id)?.truth.position));
    const info = droneInfo(store.drones);
    const id = store.selectedId && store.drones.has(store.selectedId) ? store.selectedId : null;
    const target = id ? { name: `drone${id}`, ids: [id] } : null;
    app = { store, ui, units, info, target, theatre, version, screen, act };
    const hint = ui.mode === "waypoint" ? "Click the map: a draft waypoint · double-click: the last one, and send · Esc ends"
      : ui.mode === "spawn" ? "Click the map where the new drone should stand · Esc cancels" : "";
    render(html`<${TopBar} app=${app}/><${DistanceStrip} app=${app}/><${Fleet} app=${app}/>
      <aside class="panel" id="right"><${Inspector} app=${app}/></aside>
      <${Dock} app=${app}/>
      ${hint && html`<div class="hint">${hint}</div>`}`, root);
  }

  /**
   * The routes for scene/routes.js (mock-up: none while hidden), with how many waypoints are reached:
   * by waypoint_navigator_drone<ID>.currentIndex (all once the navigator has arrived).
   * @returns {Map<string, import("../scene/routes.js").ShownRoute>}
   */
  function shownRoutes() {
    const out = new Map();
    if (!shown(store, "routes")) return out;
    for (const [id, r] of ui.routes) {
      const link = store.drones.get(id)?.link || {};
      const flown = link.navigatorStatus === ARRIVED ? r.waypoints.length : link.waypointIndex ?? 0;
      out.set(id, { waypoints: r.waypoints, flown });
    }
    return out;
  }

  return { render: draw, ui, act, shownRoutes };
}
