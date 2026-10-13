# drone_sim_v4 — Simulator & Skeleton Specification

This document captures the concrete design decisions for the drone simulation
project. It is the output of a structured design review (2026-09-21) and
complements `ARCHITECTURE.md` (system structure).

## 1. What this project is

A **clean, shareable SEN best-practices skeleton** for multi-drone mission
development. The primary deliverable is not the simulator itself — it is the
middleware infrastructure that other engineers build on top of.

Concretely:

- A SEN bus running on board each drone (the **drone bus**, `drone<ID>.bus`, shared by the
  containers of that drone's compose project: ours and one per partner component, §18).
- A shared SEN bus for inter-drone and ground-station communication (the **swarm bus**).
- A simulation-only SEN bus for god's-eye truth and rendering (the **sim bus**).
- A node framework with templates and examples so that an engineer who is **not
  a SEN expert** can add a new on-board node (e.g. sense-and-avoid, formation
  control) by copying a template, without reading simulator internals.
- A three.js swarm view (browser) for visualization and basic operator interaction.
- Docker packaging so the whole stack runs with one command (`scripts/up.sh`) on
  a clean machine.

The **skeleton** refers to the SEN middleware layer: bus topology, node
lifecycle, interface contracts, communication patterns, and the node framework.
The simulator (flight dynamics, ground assets, UI) exists to exercise the
skeleton and provide a testbed for the mission components that will be built
later.

## 2. What this project is not

- Not a flight dynamics evaluation tool — kinematic flight, no fidelity
  requirements on the physics.
- Not swarm software — no fleet behavior, no task allocation, no formation
  algorithms. Those are built *on* this skeleton.
- Not a production system — this is a development and testing tool. Security,
  hardening, and operational concerns are out of scope.
- Not the ERA2 architecture nodes themselves — just the foundation they plug into.

## 3. Consumers

The engineers on this project. They are software engineers but **not SEN
experts**. The skeleton must be legible and well-structured enough that:

1. The folder hierarchy makes it obvious where a new node goes.
2. A short README and two example nodes are sufficient to get started.
3. Standard SEN patterns are used throughout — no custom hacks or workarounds.
4. The stack can be cloned and run on a partner's machine without SEN expertise.

## 4. Scope and finish line

The skeleton is complete when a new on-board node can be
added by copying a template, editing the `.stl` and `Impl`, adding one YAML
line, and rebuilding — without reading airframe or world code.

**Status:** the skeleton and the simulator (flight model, ground assets, swarm view, scale to 10
drones, node template and examples) are done; a run on a clean machine is open. ERA2 partner nodes
and scenarios are built on the skeleton and are out of scope.

**Priority if time is tight**: SEN skeleton quality > working UI. A rough UI
with a solid, well-structured middleware skeleton is a win. A polished UI on
top of a messy skeleton is not.

**Timeline**: usable by mid-October 2026.

## 5. Flight model

**Kinematic 6DOF with attitude.** The drone has position, velocity, max speed,
and max acceleration. It flies at an airspeed between min and max toward its target.
Attitude is derived from the motion — the drone banks into turns and
pitches with the flight-path angle. This is geometry, not physics: no force/torque
model, no PID cascade, no rotor dynamics.

**First airframe: small tactical ISTAR fixed-wing UAV** (decision 2026-09-21;
hand/catapult-launched class: ~12–25 m/s, 100–500 m AGL, loiter radius ~80 m;
parameters are YAML values, so another class is a config change). Its payload
is a simulated EO/IR sensor (`sim_nodes/imaging_sensor`): it checks ground-asset
truth against range and field of view from the drone's pose and publishes
detections (`Track {id, assetType, position, time}`, `sensor.stl`) on the drone bus — the ground assets are
its surveillance targets. Same kinematic approach,
fixed-wing semantics: it has a minimum airspeed and cannot hover, turns are
coordinated (turn rate = g·tan(bank)/v, bank limited), it climbs and descends
within a flight-path-angle limit, "hold" and "arrived at target" mean loitering
in a circle, takeoff is a ground roll plus climb-out, landing a descent and
roll-out on the current heading. A multirotor variant (hover, stop at
waypoint) is a later extension behind the same flight controller interface.
All of this is the airframe's (`packages/airframe`, `SimAirframe` statics `maxBankDegrees`,
`maxFlightPathDegrees`, `loiterRadius`); the contracts are agnostic to the vehicle model:
`AirframeEnvelope` carries only speeds and `arrivalRadius`.

The flight model needs to look natural in the swarm view. It does not need
to be physically accurate. The use cases are mission-level: one drone follows a
target, one surveys an area, three fly in formation. The flight model just
needs to get drones from A to B convincingly.

## 6. Node framework and folder structure

```
packages/nodes/
  drone_nodes/              ← on-board nodes (run on drone, see drone bus)
    example_node/           ← minimal copy-and-modify template
    waypoint_navigator/           ← working example: receives waypoints, follows them
  ground_station_nodes/                ← ground station nodes (run on ground station, see swarm bus)
    fleet_monitor/          ← working example: tracks fleet status
  sim_nodes/                ← simulator-specific stand-ins (not on real hardware)
    imaging_sensor/              ← simulated ISTAR payload: detections of ground assets
```

**Grouping principle**: `drone_nodes/` contains code that would run on a real
vehicle. `ground_station_nodes/` contains ground-station logic. `sim_nodes/` contains
simulator infrastructure that a real system would replace with its own
components.

### 6.1 Minimal template (`drone_nodes/example_node/`)

A complete, working SEN node that engineers copy and modify. Contents:

- `stl/drone_sim/nodes/example_node.stl` — its own interface: `position` (read from the
  flight controller), `message` and one method `setMessage(message) -> CommandAck`
- `src/example_node_impl.{h,cpp}` — snake_case file names as in `airbus/sen/examples`;
  its object is `swarm.bus/example_drone<ID>` (others call it, §3 placement rule); it subscribes to
  `flight_controller` on its drone bus via a member `Subscription<FlightControllerInterface>`, opened in
  the first `update()` (lock order, ARCHITECTURE.md §8), and publishes `position`; `setMessage` is called over
  `swarm.bus` (the ground station, another drone, `scripts/smoke.sh`) and the node publishes the last `message`
- `CMakeLists.txt` — `add_sen_package` with `DEPS drone_sim_interfaces` only; the same file builds
  stand-alone against the partner SDK (`find_package(drone_sim REQUIRED)` when it is the top level)
- `config.yaml` — the YAML block that loads it, next to the code (as `my_counter` has)
- `Dockerfile`, `drone.yaml` — the same node as an on-board partner container (§18, the shape of
  `examples/partner_geocage/`): object `swarm.bus/example_sidecar_drone<ID>`, compose service
  `example_sidecar`, profile `example_node`
- One `include:` line in `config/drone.yaml` and one line in `packages/CMakeLists.txt`

~30 lines of real code: subscribe, publish, receive a call. Nothing else. An engineer copies the directory, renames, edits the
`.stl` for their interface, fills in `update()` with their logic.

### 6.2 Waypoint navigation node (`drone_nodes/waypoint_navigator/`)

An example of driving `flight_controller`, not the navigation the drone will have (temporary
scaffolding: ARCHITECTURE.md §4.3). A working on-board node that demonstrates a non-trivial SEN pattern:

- Receives a route via a `setRoute(Route, speed)` method on `swarm.bus/waypoint_navigator_drone<ID>`
  (`Route {id, waypoints}`, a subset of `aucc.Route`; accepted in any mode and
  flown once airborne, so "send route, then take off" works)
- Follows waypoints sequentially by calling `flight_controller.goToPosition()` for each one
- Publishes progress on that same swarm-bus object: current waypoint index,
  distance to next waypoint, status (idle / navigating / arrived)
- Advances to the next waypoint when within a threshold distance

This is a reference for SEN node structure: receiving commands, maintaining internal state,
driving the flight controller, and publishing status. Its waypoint-following behavior is an
example, not the final project's autonomous navigation architecture; partners provide that
behavior in their own nodes.

### 6.3 Fleet monitor node (`ground_station_nodes/fleet_monitor/`)

A ground-station-side example that demonstrates the swarm-bus subscription pattern:

- Subscribes to all `DroneLink` objects on `swarm.bus` using a typed interest
  query (`SELECT drone_sim.DroneLink FROM swarm.bus`)
- Tracks which drones are alive via heartbeat timeouts
- Publishes a `swarm.bus/fleet_status` object with alive/dead counts and
  per-drone summary

Demonstrates: typed interest queries, multi-object discovery and tracking,
heartbeat-based liveness detection, and publishing aggregated state.

### 6.4 Node interface locations

**Each node owns its `.stl`** — the layout SEN's own examples use. Only the bus
contracts are shared:

```
interfaces/                              the `drone_sim_interfaces` package
  stl/drone_sim/common/types.stl                GeoPosition, GeoPositionList, Route, NavigatorStatus, Vec3, Quaternion, FlightMode, CommandAck
  stl/drone_sim/drone_bus/flight_controller.stl   VehicleState, AirframeEnvelope, FlightController
  stl/drone_sim/drone_bus/sensor.stl            Track, Sensor           CHANGING.md: the change procedure
  stl/drone_sim/swarm_bus/                      drone_link.stl  ground_station.stl  waypoint_navigator.stl (WaypointNavigator)
  stl/drone_sim/sim_bus/                        world.stl  truth.stl  ground_asset.stl

packages/nodes/drone_nodes/example_node/
  stl/drone_sim/nodes/example_node.stl          this node's interface, built by this package
  src/…  CMakeLists.txt  config.yaml
```

**The `.stl` files are the reference of highest priority** (2026-09-22): where this
document or `ARCHITECTURE.md` describe a type differently, the `.stl`
is right and the document is fixed. Nothing is frozen yet; a freeze is a hand-off
decision (`interfaces/stl/drone_sim/drone_bus/CHANGING.md`).

The `stl/drone_sim/…` prefix mirrors the import path, as SEN requires for interfaces
that may be exported (`airbus/sen/docs/howto_guides/exportable_interfaces.md`):
`import "stl/drone_sim/common/types.stl"`, `#include "stl/drone_sim/drone_bus/flight_controller.stl.h"`.
A node package lists `DEPS drone_sim_interfaces` and gets both the import path and
the generated headers. Adding a node is therefore one directory plus one line in
`packages/CMakeLists.txt` — no edit to a shared interfaces list.

There is no `interfaces/nodes/`: `interfaces/` is reserved for what crosses a
bus contract, and `drone_bus/` for the core contracts every node depends on.

## 7. SEN patterns demonstrated

The skeleton must use **standard SEN coding patterns** throughout. The example
nodes and existing components collectively demonstrate:

| Pattern | Where demonstrated |
|---------|-------------------|
| Subscribing to a typed object | `example_node` → `flight_controller` (its drone bus, opened in the first `update()`); the airframe's `drone<ID>` → `flight_controller`; `imaging_sensor` → `flight_controller` and → every `GroundAsset` |
| Publishing properties in `update()` | all Impl classes |
| Declaring a `.stl` interface in the node's own package | every node; `DEPS drone_sim_interfaces` for shared types |
| Method implementation (returning `CommandAck`) | `flight_controller`, `world`, `drone_link`, `waypoint_navigator.setRoute` (validation), `example_drone<ID>.setMessage` |
| Deferred method forwarding | `swarm.bus/drone<ID>` (airframe) → `flight_controller`, promise-based; a node method over the air needs none: the node is on `swarm.bus` itself (`waypoint_navigator_drone<ID>.setRoute`) |
| `[static]` properties from YAML config | `world.origin`, `flight_controller.envelope`, `flight_controller.droneId`, the bus-name statics, `fleet_status.lostAfter` |
| Struct `[static]` from YAML | `world.origin`, `flight_controller.envelope` (nested map in YAML) |
| `[confirmed]` for once/on-change values and unbounded sequences | `flight_controller.homePosition`, `waypoint_navigator.route`, `fleet_status.drones`; `flight_controller.state`, `truth_drone<ID>.state`, `drone<ID>.telemetry` are best-effort — one struct committed in one cycle, never half-updated |
| Runtime value that cannot be a `[static]` | `flight_controller.homePosition` — the launch position and its ground altitude AMSL (the AGL datum for `takeoff`), known only once `world.origin` has been discovered, so a plain `[confirmed]` property published once |
| Objects named from the environment | `drone@env(DRONE_ID)` (`swarm.bus`) and `truth_drone@env(DRONE_ID)` (`sim.bus`), both of the airframe component, `waypoint_navigator_drone@env(DRONE_ID)`, `example_drone@env(DRONE_ID)` (`swarm.bus`): YAML objects with their own subscriptions and a `droneId` static, nothing created at runtime; C++ picks by `droneId`, never by name |
| Extending a contract class | `SimAirframe : extends FlightController`, `SimSensor : extends Sensor` (`imaging_sensor`) — simulator-only statics without touching the contract; impl base `SimXBase<XBase>` |
| Typed interest queries | `fleet_monitor` (`SELECT drone_sim.DroneLink FROM swarm.bus`); the drone process holds no `swarm.bus` interest (its nodes there are called, they do not call); a drone node that reads `swarm.bus` keeps one string per class shared by every component (ARCHITECTURE.md §8); `imaging_sensor` (`SELECT drone_sim.GroundAsset FROM sim.bus`, disjoint from the airframe's `SELECT drone_sim.World` in the same process — the one safe way to hold two interests on a shared bus); `viz/app/sen/feed.js` holds one untyped interest per bus and dispatches on `className`. Both shapes are a workaround for the kernel bug at SEN `05da288e` (§9 of `ARCHITECTURE.md` has the full description), to be removed when upstream fixes it |
| Multi-object discovery | `fleet_monitor`, `viz/app/sen/feed.js` |
| SEN events | emitted: `waypoint_navigator.arrived`; received: `waypoint_navigator_test.cpp` (`onArrived`, counted once; a node keeps the `ConnectionGuard` as a member) |
| `@env()` runtime parameterization | `drone.yaml` (`DRONE_ID`), `world.yaml` (`REST_PORT`, `RECORD`) |

`[writable]` properties are supported and partner nodes use them (§16), but the
skeleton's own code prefers a method invoke wherever the caller needs an ack.
None of the shipped nodes has one (the template stays small, user 2026-10-07); the choice
between `[writable]` and a method is spelled out in `packages/nodes/README.md`.

Both property subscription (continuous monitoring) and request/response methods
should be architecturally straightforward using standard SEN patterns. The
examples don't need to demonstrate every combination, but the bus topology must
support both.

## 8. Waypoint system

The waypoint system spans two components:

1. **Browser (`viz/app/`)**: the operator clicks points on the map to build a
   waypoint list, then sends it via REST invoke on
   `swarm.bus/waypoint_navigator_drone<ID>.setRoute(route, speed)` (`Route {id, waypoints}`,
   speed 0 = cruise) and gets the navigator's ack (operators call the drone's objects directly).
   This is browser-side JavaScript, not a SEN node; `scripts/smoke.sh` sends the same call from the shell.

2. **On-board waypoint_navigator node**: lives on `swarm.bus` as `waypoint_navigator_drone<ID>`
   (the operator calls it there directly), follows waypoints by calling
   `flight_controller.goToPosition()` on its drone bus for each one, and publishes progress
   (`status`, `currentIndex`, `route`).

## 9. The air link (no radio component)

`swarm.bus` crosses between drones and the base station over an IP network below SEN (`ether`
over a mesh radio on a real system, the Docker network here). Link quality is **not simulated**,
and there is no radio component bridging the drone bus and `swarm.bus`. The placement rule (ARCHITECTURE.md §3): an object lives on `swarm.bus` if another
drone or the ground station calls or reads it (`drone<ID>`, `waypoint_navigator_drone<ID>`),
everything else stays on the drone bus. `drone<ID>` is published by the
airframe (the vehicle's face: telemetry, envelope, heartbeat, the six flight-controller commands),
because `flight_controller` stays off the shared bus.

**Adding a cross-drone message** is a method on the node's own `.stl`, called on the peer's object on
`swarm.bus` (found by `droneId`); no forwarder. Losing the ground station is tested for real: stop or
`docker pause` its container, its heartbeat stops (an on-board partner C2 component reads it).

## 10. UI

A three.js "architect's model" of the theatre, the only view:
three.js, Preact + htm and fonts vendored, ES modules + import map, no bundler, no npm.
**All of it lives under `viz/`** — `serve.py`, `index.html`, `swarm.css`, `app/`,
`sen_client.js`, `vendor/`, `data/<area>/`, `fetch_area_assets.py`, `test/`. Nothing
of the UI exists outside that directory, and the drone image excludes all of `viz/`.

**No API keys, no accounts, anywhere** (decision 2026-09-21): the project will be
open source and must be trivially shareable, which rules out
MapTiler and Google Photorealistic 3D Tiles.

### Rendering (from sim bus via SSE)
- Drones: positioned by truth, oriented by attitude (bank into turns), glided
  between 10 Hz samples so motion is smooth; a minimum on-screen size at theatre zoom
- Ground assets: positioned by `position`, oriented by `heading` (top-down billboards)
- Clock readout: sim time, time scale, paused indicator
- **Terrain** from a committed per-area theatre DEM (`viz/data/<area>/dem_theatre.bin`,
  60 × 40 km at 30 m, Copernicus GLO-30) + OSM land cover (`landcover.png`); no
  buildings, no imagery, no request leaves the origin. URL: `?fps`, `#` presets
- The flat sim over a bumpy map: a flying thing is drawn at `groundH + altitude`
  (`groundH` = DEM height at the origin), a ground thing is clamped to the DEM
  under it. Terrain following belongs in the sim (later), never in the renderer

### Interaction (commands via swarm bus REST, on the drone's own objects)
- **Select**: click a drone (map or fleet list) to select it
- **Waypoint**: with a drone selected, click on the map to add a waypoint
  (drawn as a numbered draft); "send" dispatches the list via
  `waypoint_navigator_drone<ID>.setRoute(route, 0)`, "clear" discards it; shift+click is a straight `goToPosition`
- **Commands**: command dock for arm, takeoff, land, disarm on the selected drone. Every drone command
  is a method on the drone's own object on `swarm.bus`, `drone<ID>` or `waypoint_navigator_drone<ID>`,
  and returns the drone's ack
- **Time control**: time-scale slider and pause/resume button invoke
  `sim.bus/world` methods
- **Info panel**: shows the drone's state as the simulator publishes it (position, altitude, speed, course
  and heading from `truth_drone<ID>`; mode and battery from `drone<ID>` when it is there) plus the route
  status of `waypoint_navigator_drone<ID>`; no drone bus is read. `fleet_status` liveness and the link's
  presence feed the C2 row, each drone's status and the Critical count
- **Spawn / Remove**: spawn button → click on the map → a pulsing
  placeholder with a seconds counter → a drone (its compose project) starts there and joins the swarm bus
  (~1 s); Remove takes down the selected drone's compose project. `scripts/spawn_drone.sh <id> [lat lon]`
  and `docker compose -p drone<id> -f docker/drone.compose.yml --profile '*' down` do the same from the shell.

### serve.py (`viz/serve.py`)
- Static file server for the web client
- Reverse-proxies `/api` to SEN REST (same-origin, avoids CORS)
- `/spawn` and `/kill`: `docker compose -p drone<N>` on `docker/drone.compose.yml`;
  `/reset`: an ordered restart to `scenarios/initial.yaml` (ARCHITECTURE.md §7)
  (the web image carries the Docker CLI) over the mounted socket; Docker socket access from a dev tool is acceptable

## 11. Distribution and partner onboarding

**Goal**: a partner clones the repo and has drones flying in their browser
within minutes, without SEN expertise.

**Steps**:
1. `git clone` this repo
2. `scripts/up.sh` (builds what is missing — the first time also the SEN base image,
   pinned SEN commit, once per machine — then starts world, ground_station, web and two drone compose projects)
3. Open `http://localhost:8000`

The SEN base image (`drone_sim/sen-base:<SEN commit>`) contains the SEN runtime, codegen, and
CMake config. Every service image is `FROM` it and compiles this repo's
packages. Partners build that base image themselves (decision 2026-09-22, since
then the release file carries the built image instead, so no registry is needed). A
pre-built image on a registry may follow later; the `SEN_BASE` build arg is the hook.

Native run (no Docker) needs a local SEN install and is for us, not partners
(partners use Docker). It is supported for fast iteration during development:
same YAML files, one `sen run` per process, launched by `scripts/run_native.sh`.

## 12. Ground assets

Tanks and trucks driving waypoint loops on the sim bus. These represent
mission-relevant entities for ERA2 scenarios (surveillance targets, convoy
escort, etc.).

Ground assets are kinematic path followers defined in `config/world.yaml`
(asset type, waypoint loop, speed). They publish position and heading on
`sim.bus`.

## 13. Scale

Target: up to ~10 drones on one laptop. One Docker container per drone, each
with its own SEN kernel. If 10 is too heavy, 5 is acceptable. The architecture
does not need to support hundreds of drones.

## 14. Interface harmonisation with partner .stl files

Partner repos (`era2-sen-wp5000` / `era2-sen-wp4000`) contain the `.stl`
definitions for the components that will eventually run on this skeleton.
Where our simulator's interfaces overlap with theirs, they should be
**similar or identical** so that partner nodes plug in without adapter code.

Partner `.stl` sources are not in this repo: the build takes them from the partners' repositories in
git-ignored `external/wp4000`, `external/wp5000` (tested commits pinned in `README.md`). Never
edit `external/`: fixes go upstream via the WP4000 maintainers.

### Overlapping areas to harmonise

| Area | Our type | Partner type | Relation |
|------|----------|--------------|----------|
| **Position / waypoint** | `drone_sim.GeoPosition` | `aucc.Waypoint`, `aircraftera.Waypoint` | Same field names as `aucc.Waypoint` (2026-09-21), not the same type: partner nodes convert per field. `aircraftera.Waypoint` differs more (units). |
| **Waypoint list** | `drone_sim.GeoPositionList` | `aucc.WaypointSequence` | Separate packages; partner nodes convert. |
| **Route** | `drone_sim.Route` | `aucc.Route` | Field-compatible subset (id + waypoints); partner-only fields stay out. |
| **Flight mode** | `drone_sim.FlightMode` (lifecycle: armed, takeoff, hold, goingTo, land, `crashed`) | `aircraftera.FlightMode` | Deliberately different: partner modes are flight-control level, ours vehicle lifecycle. No change. |
| **Command ack** | `drone_sim.CommandAck` | `aucc.MsgAck` | Deliberately different: ours is richer (status + message). No conflict. |
| **Vehicle ID** | `FlightController.droneId` (string) | `aucc.VehicleID` | Ours is the link; partner nodes keep their own ID struct. |
| **Telemetry** | `drone_sim.VehicleState` on `FlightController.state` | `av_confinement.Telemetry` | Carries the derived fields partner telemetry expects (`heading` = nose, `course` = track, `groundSpeed`, `verticalSpeed`; 2026-09-21/22). Partner nodes convert and subscribe to the flight controller. |
| **Units** | metres AMSL, degrees | partner packages differ in places | Partner nodes convert internally. |

### ground station .stl

A partner-provided ground station `.stl` was not found in either WP4000 or WP5000 repos.
Our `ground_station.stl` (currently just `heartbeat : u64`) must be harmonised with the
partner's interface definition once it is available.

## 15. Key design decisions

| Decision | Rationale |
|----------|-----------|
| Kinematic flight, not rigid-body dynamics | Mission-level behavior testing, not flight dynamics evaluation |
| Two example nodes (drone + ground station) + one template | Engineers learn by reading code; template is the copy-and-modify starting point |
| No radio component; nodes others call or read are on `swarm.bus` themselves | The air link is IP below SEN and not simulated, so a bridge would only copy data; a cross-drone message is a method on the node's own `.stl` |
| Browser-side waypoint dispatch | Simplest path; no unnecessary SEN node hop |
| Spawn/kill via `scripts/spawn_drone.sh` / `docker compose -p drone<id> … --profile '*' down`, and UI buttons over `serve.py` `/spawn`, `/kill` | The skeleton does not need them; Docker socket access from a dev tool is acceptable when they come |
| Partners build the base image themselves; pre-built image on a registry maybe later (2026-09-22); a release file instead (below) | The release file does the job without a registry; a partner builds once (~30 min) or loads the file |
| `sim_nodes/` vs `drone_nodes/` distinction | Makes it clear what's simulator scaffolding vs. what would run on real hardware |
| SEN best practices, no custom hacks | The skeleton IS the reference implementation for how to write SEN nodes |
| Each package owns its `.stl`; `interfaces/` holds bus contracts only (2026-09-21) | What `airbus/sen/examples` does. A new node is one directory, not an edit to a shared list |
| `stl/drone_sim/…` folder layout, target `drone_sim_interfaces` (2026-09-21) | SEN's rule for exportable interfaces; generic names like `common/types.stl.h` cannot shadow another project's |
| One `VehicleState` struct instead of ten loose properties (2026-09-21) | No half-updated snapshots, one time-of-validity, derived telemetry fields computed once |
| `AirframeEnvelope` `[static]` on `FlightController`, `[confirmed]` on `DroneLink` (mirrored once at runtime), resolved values (2026-09-21); only what any vehicle has: speeds and `arrivalRadius` | Nodes and the ground station plan inside the vehicle's limits; no "0 means default" sentinel on a contract; fixed-wing limits stay `SimAirframe` statics so an airframe swap touches `packages/airframe` only |
| Simulator knobs live on `SimAirframe : extends FlightController`, not on `FlightController` (2026-09-21) | The partner-facing contract carries no simulator knob; a typed interest on `drone_sim.FlightController` still finds the object |
| Bus names are `[static] string` properties from YAML (2026-09-21) | What SEN's examples do (`TerrainClient.serverBus`); no bus-name literal in C++ |
| All of the UI under `viz/` (2026-09-21) | The UI is not the deliverable; it also keeps it (~6.6 MB) out of the drone image |
| three.js swarm view replaces Cesium (2026-09-29) | Reads at a glance at theatre zoom; 1 MB vendored instead of 23 MB; nothing fetched at runtime |
| No API keys or accounts anywhere (2026-09-21) | The project is meant to be cloned and run by anyone, offline included |
| Drone bus `drone<ID>.bus` instead of `local.drone`; a drone is a compose project of containers; partner components are images in it or on the base station (2026-09-27, §18) | Partners ship only images; adding one is a compose service. Costs: isolation by naming instead of enforced, the one-query rule on the drone bus |
| Names are whole words, prefix `drone_sim`, SI units unless the name says otherwise; closed list of short forms in `docs/GLOSSARY.md`, guarded by `scripts/check_names.py` (2026-09-27) | Partners read our names before our documents; after hand-over a rename costs every partner a rebuild and a code change |
| Partners build against one versioned surface, `/opt/drone_sim` in `drone_sim/sim:<VERSION>` (`find_package(drone_sim)`, one ether include), not our repo layout; the image is also released as one file (2026-09-28, §18) | `/app` stays free to change; a version a human can read; a partner can load the image instead of an ~90 min build |
| A partner component always runs in its own container; partners build from source at their site and most likely hand over only the image; profile per component; a stand-in is retired in the commit that adds the partner's (2026-09-28, §18) | One model for every delivery: no rename or rework when a partner switches delivery or replaces a stand-in |

## 16. Partner interface analysis (ERA2 WP4000/WP5000)

Partner `.stl` files were reviewed (2026-09-21) to validate the skeleton's
architecture against the components that will eventually run on it.

### Expected on-board nodes (all drone-bus nodes)

| Component | Package | Role |
|-----------|---------|------|
| DAA (Detect & Avoid) | `aucc` | Cooperative/non-cooperative avoidance, TCAS integration |
| Create Route | `aucc` | Route planning with waypoints, POIs, constraints |
| Manage Mission | `aucc` | Mission coordination, formation management, comms config |
| Flight Dynamics Model | `aircraftera` | Autopilot interface, route execution, waypoint/route modes |
| Trajectory Predictor | `av_confinement` | Trajectory prediction from telemetry + flight plan |
| Airspace Monitor | `av_confinement` | Airspace compliance, breach detection, geofencing |
| ACEM | `acem_package` | Escalation management (nominal → contingency → emergency) |
| Route Replanning | `route_replanning` | Replans a route on a waypoint graph (added 2026-10-06; caller unconfirmed) |

### SEN patterns used by partners

The skeleton must support these patterns, even if the example nodes don't
demonstrate all of them:

- **`[writable]` properties**: partners use `[writable]` extensively for
  cross-node communication on the drone bus (one node writes another's
  properties directly). Our skeleton prefers method invokes for mutations, but
  `[writable]` is a valid SEN pattern for intra-drone-bus communication and
  partner nodes will expect it to work. Described, not shown: no node of ours writes a peer's
  property; the write side is explained in `packages/nodes/README.md`.
- **`[static]` properties from YAML**: config paths, bus names, initial state.
- **`[confirmed]` for grouped updates**: routes, compliance results, flight
  plans — anything that must not be observed half-updated.
- **SEN `event` declarations**: partners use events for asynchronous
  notifications (warning, alert, fault, newPredictedTrajectory). The skeleton
  should consider demonstrating this pattern.
- **Struct-typed method arguments and returns**: complex data passed through
  methods, not just scalars.
- **Sequences of structs**: waypoint lists, trajectory points, formation
  member lists.

### Type compatibility

Partner packages (`aucc`, `av_confinement`, `aircraftera`, `acem_package`, `route_replanning`) use
their own type definitions. Our skeleton uses package `drone_sim`. No type name
conflicts exist. Partners define their own `Waypoint`, `Latitude`, `Longitude`
etc. — these are separate SEN packages and don't need to share types with
`drone_sim`.

Unit convention differences (partners use feet in some places, radians in
others, with FIXMEs) are internal to their packages and don't affect the
skeleton's bus infrastructure.

### Architecture validation

All partner components are drone-bus nodes. They subscribe to the flight controller and each
other, publish their own objects, and communicate via properties and methods —
exactly the pattern our skeleton supports. A component another drone or the ground station calls or
reads publishes on `swarm.bus` itself (ARCHITECTURE.md §3 placement rule; there is no radio
bridge), as `waypoint_navigator` does.
A partner component delivered as a Docker image runs as a container in the drone's compose project,
on the same drone bus (§18).

## 17. Open items

- **Partner ground station `.stl`**: not found in WP4000/WP5000 repos; harmonise when
  available from partners
- **SEN events**: partner nodes use `event` declarations; `waypoint_navigator.arrived`
  demonstrates the pattern. Note that the REST/SSE bridge does not
  make events useful to the browser, so the UI reads status properties instead
- **`[writable]` vs method-invoke guidance**: done, `packages/nodes/README.md`
  ("Choosing the SEN construct")
- **Three SEN-level issues** (third, 2026-09-22: the
  `sim.bus` truth stream froze once a REST client held a second interest matching
  `truth_drone*` — root-caused the same day as a SEN kernel regression at the pinned
  commit, not compose: two *different* interests matching one remote object in one
  process stop its updates after 5 s. Rule since then: one untyped `SELECT * FROM <bus>`
  per bus in viz and smoke, dispatch on `className`)
- **Also open**: clock base (world uses wall clock, movers integrate the measured
  `api.getTime()` delta — decided), `LICENSE` file (deferred), clean-PC check. A drone bus is
  inspected from the world's REST (`SELECT * FROM drone<ID>.bus`).
- **The first two** (found in an early stress
  run): publishing per-drone state at 50 Hz wedges the buses under compose (not
  reproducible on 2026-09-22 with one-interest REST clients, 8 drones, 165 s — most
  likely the interest bug above), and
  SEN's REST `clientAuthSessionHandler` segfaulted once on a re-used client id
- **Partner images** (§18) are rebuilt when `CHANGING.md` says a type changed; agree with the partners how
  often that is acceptable
- **Done**: stress test at 5–10 drones (10 are comfortable on an 8-core laptop);
  deferred method forwarding validated against `airbus/sen/examples/packages/fibonacci`

## 18. Partner components (Docker image + `.stl`, or source)

**Need** (2026-09-27): some partners will not share source code but will contribute SEN
components. A partner develops and builds its component at its own site and hands over two
things only: a **built Docker image** and the **`.stl` file** of its interface. We must be able
to run it **on board a drone or on the base station**, our choice, as simply as adding the image
to a compose file.

### The model: a drone is a compose project of containers on its own bus

- **The drone bus is `drone<ID>.bus`** (YAML `drone@env(DRONE_ID).bus`), a normal SEN session,
  instead of the process-local `local.drone`. Ether connects only processes that open the same
  session, so drone 1's bus holds drone 1's objects and nothing else.
- **Naming**: every container of drone N's compose project gets `DRONE_ID=N`, and every drone-bus YAML (ours
  and the partner's) says `drone@env(DRONE_ID).bus`, so no per-drone config and no bus name in C++;
  ids must be unique (`ARCHITECTURE.md` §3.1).
- **A drone is a compose project** (`docker/drone.compose.yml`, project `drone<ID>`): our `core`
  container (airframe, our nodes — still one process) plus one service per on-board partner
  image, sharing the core's network namespace (`network_mode: service:core`). Spawn and kill start
  and stop the whole project.
- **Base-station components** are services in `docker-compose.yml` on `swarm.bus`.
- **Isolation is by naming, not enforced.** Only session `local` is enforced by SEN, and it is
  single-process by definition. A process could open another drone's bus or `sim.bus`; ours don't,
  partners are told not to. Security is out of scope (§2). Our on-board nodes and a partner's
  on-board container open their drone bus and `swarm.bus` (the air link, §9; rule below).
- Measured 2026-09-27: per-drone buses stay separate, a route flows
  swarm → a sidecar's `waypoint_navigator` → `flight_controller` and back for 100 s with nothing frozen, a
  restarted sidecar rejoins, and a sidecar costs ~0.14 core and ~9 MiB.

### What the hand-over is

| Item | Content |
|------|---------|
| Image | `docker save partner/<pkg>:<version> \| gzip` — a file, no registry (§15: no accounts). Runnable: `sen run` with its own YAML per placement (bus names from `@env(DRONE_ID)`) |
| `.stl` | The component's interface, verbatim, own SEN `package`. Kept as the interface document; compiled by us only where *our* code reads it typed (none now); REST and the UI read any remote object without it |
| README | Classes, `[static]` knobs, which YAML is for which placement, image tag |

### Rules

- **Build `FROM drone_sim/sim:<VERSION>`** (built from this repo, which partners have, or loaded from
  our release file `drone_sim-sim-<VERSION>.tar.gz`): same SEN pin, our contracts and their
  libraries. Build **against the partner SDK only**, `/opt/drone_sim` (`ARCHITECTURE.md` §4.4):
  `find_package(drone_sim)` gives `drone_sim_interfaces` (no partner library: the SDK is ours
  only), every YAML includes
  `/opt/drone_sim/config/ether.yaml`; nothing under `/app` is a partner interface. The SDK paths
  are a contract like the `.stl` files: changed only with a version bump.
- **The contract version travels with the image** (`/opt/drone_sim/VERSION`), a label nothing
  checks: a partner rebuilds when `CHANGING.md` says a type changed, because SEN converts mismatched
  types silently (`ARCHITECTURE.md` §4.4).
- **One build of the ERA2 types, in the partner's image**: our image and SDK hold no WP4000/WP5000
  `.stl` and no `libwp*` (closed files). A partner component that needs them builds
  `wp4000`/`wp5000` in its own image from the pinned partner commit, never builds its own
  copy of a `.stl` of ours, and ships only its own libraries. The WP4000/WP5000 `.stl` files live in
  the partners' repositories (git-ignored `external/wp4000`, `external/wp5000`, not in this
  repository, not open source) and are versioned by that repository's commit, pinned in
  `README.md`; a change lands there, everybody rebuilds on the new pin.
- **Drones and the base station talk on `swarm.bus`**: a partner's
  on-board container may open `swarm.bus` (its air link) as well as its drone bus, and publishes by
  the placement rule (on `swarm.bus` what others call or read, as `<name>_drone<ID>` with a `droneId`);
  its base-station half publishes on `swarm.bus`. No bridge of ours is in the path, so a delivery
  changes no code or contract of ours.
- **On the drone bus and `swarm.bus`: one query per class per process** (the pinned kernel bug, `ARCHITECTURE.md`
  §9, now applies there too because objects cross processes). Our nodes already comply.
- **Tolerate late peers**: containers start in any order; subscription lists fill when peers appear.
- The `.stl` is kept verbatim in `external/<pkg>/` with its image tag; a changed `.stl` is a new
  image version.
- Every service of partner component `<name>` carries `profiles: [partners, <name>]`, so a clean
  clone runs without partner images, `COMPOSE_PROFILES=<name>` runs one component and
  `COMPOSE_PROFILES=partners` all of them.

### One deployment model: develop from source, hand over an image

A partner develops its component from source at its own site, built against the partner SDK in
`drone_sim/sim`, and runs it in our stack while it iterates. When it shares the component it most
likely hands over only the pre-built image and the `.stl`; a source delivery is the exception. Both
follow one model, fixed before hand-over so no later delivery forces a rename: **a partner component
always runs in its own container; a source delivery only adds a `build:` line.** The deployment table and its rules are
`ARCHITECTURE.md` §4.4; in short:

- **Names**: `<name>` (whole words) is the `external/<name>/` folder, the image
  `partner/<name>:<version>`, the in-image folder `/partner/<name>/` (`drone.yaml` on board,
  `base.yaml` at the base station) and the compose profile; a service is named after its object.
- **Source**: the partner's folder (the shape of `examples/partner_geocage/`) goes to
  `external/<name>/source/` (as delivered, or a git submodule); the compose service gets a
  `build:` of it next to its `image:`, `FROM drone_sim/sim`. `scripts/up.sh` builds it after
  `drone_sim/sim`, one build at a time; spawning a drone never builds.
- **Replaceability**: consumers read the class a replacement implements (the partner class, or our
  contract class in `interfaces/`), never a `Sim*` class (`ARCHITECTURE.md` §4.3 map).
- **Retiring a stand-in** (none exists now): the commit that adds partner component X removes
  X's stand-in block from `config/drone.yaml`; two implementations of one component on one bus is an error.
- **Absent**: a component whose profile is off is not there; consumers tolerate it, and the UI
  shows its status as missing (it reads the node itself).
- Partner components are Docker-only; native runs (`scripts/run_native.sh`) are ours and run
  without them.
- **The template in both placements**: `example_node` runs in our core process and, from the
  same folder, as an on-board partner container (`Dockerfile`, `drone.yaml`, service `example_sidecar`,
  profile `example_node`), built against `/opt/drone_sim` only: a partner's development loop. The absent
  rule was checked then: no profile, `smoke.sh` and `/reset` pass; a killed sidecar stops nothing else of
  its drone.

### The example: `geocage` (the global flight area)

Source in `examples/partner_geocage/` (what a partner has at its site; not part of our build); one
image `partner/geocage`, two placements chosen by the compose `command:`; the `.stl` is
self-contained (no import of ours):

- `geocage.GeocageService` — base station, service `geocage` in `docker-compose.yml`, object
  `swarm.bus/geocage`: `geocage` (`[confirmed]`, initial value `initialGeocage` from YAML),
  `setGeocage(geocage) -> bool`.
- `geocage.GeocageStore` — on board, service `geocage_store` in `docker/drone.compose.yml`, object
  `drone<ID>.bus/geocage_store`: one typed interest on `swarm.bus`, holds the last geocage heard
  (`geocage`, `received`, `serviceUp`), kept while the service is gone.
- Our side: the two compose blocks (the received `.stl` is kept in `external/geocage/`, which
  nothing of ours compiles, outside the public repository); the UI draws `swarm.bus/geocage`.
