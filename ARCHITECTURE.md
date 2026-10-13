# drone_sim_v4 — System Architecture

This document describes *what the system is and how its parts fit together*.
The concrete design decisions (flight model, node framework, UI, partner interfaces) live in
`sim_spec.md`.

## 1. One-paragraph summary

A swarm of simulated drones, each a small group of containers — a *compose project*: our core SEN
process plus any partner components delivered as Docker images — sharing one **drone bus**,
`drone<ID>.bus`.
Between drones, the ground station and the UI, everything travels over one
**swarm bus**. A single **world** process owns the physical environment (terrain,
ground assets, simulation clock) and exposes a god's-eye **sim bus** that the UI
renders from. All communication is SEN; the browser only sees SEN through REST/SSE.

Goals: **topologically honest** (every drone is its own compose project on its own drone bus; code
that runs here runs unchanged on the vehicle), **runnable anywhere** (clone, `scripts/up.sh`, open a
browser; no hand setup, no generated configs), **simple** (a prototyping and testing project: the
smallest thing that demonstrates the architecture, one smoke script) and **legible** (standard SEN
patterns only; the folder layout shows where a new node goes). Non-goals for now: flight-dynamics
fidelity (the flight model is kinematic), swarm behaviour itself, radio-link degradation, a real
autopilot backend, a second airframe, replay, multi-host deployment, sim-side terrain.

```
```
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ swarm bus   (SEN session "swarm", crosses containers via ether)          │
 └──┬───────────────┬────────────────┬──────────────────┬───────────────────┘
    │               │                │                  │
 ┌──┴─────────┐  ┌──┴─────────┐   ┌──┴─────────┐    ┌───┴───────────────────┐
 │ drone1     │  │ drone2     │   │ ground_    │    │ world                 │
 │ ┌────────┐ │  │            │   │  station   │    │ terrain, ground assets│
 │ │ nodes… │ │  │  (same     │   │ + ground-  │    │ clock, environment    │
 │ ├────────┤ │  │   image,   │   │ station    │    │ rest ⇐ browser (3D UI)│
 │ │ flight │ │  │   same     │   │ nodes      │    └───────────┬───────────┘
 │ │ control│ │  │   config)  │   └────────────┘                │
 │ │ + model│◄┼──┼────────────┼─────────────────────────────────┘
 │ └────────┘ │  │            │   sim bus (session "sim")
 │ drone bus  │  │ drone bus  │      drone bus = SEN session "drone<ID>":
 │ (drone1)   │  │ (drone2)   │      joined only by that drone's containers
 └────────────┘  └────────────┘
 A drone's objects that others call or read (drone<ID>, waypoint_navigator_drone<ID>)
 are published on the swarm bus itself; there is no radio bridge (§3).
```

## 2. Processes and containers

One service image `drone_sim/sim` (all packages, `FROM drone_sim/sen-base`); the compose
`command:` picks the process's YAML. `web` is a separate python image
(`docker/Dockerfile.web`, build context `viz/`).

| Process  | Count | Image           | Joins sessions        | Owns |
|----------|-------|-----------------|-----------------------|------|
| `world`  | 1     | `drone_sim/sim`      | `sim`, `swarm`        | terrain/env, ground assets, sim clock, REST gateway for the UI |
| `drone<N>` (core container) | N | `drone_sim/sim` | `drone<N>`, `swarm`, `sim` | one airframe (kinematic flight model + flight controller, and `swarm.bus/drone<N>`), our on-board nodes |
| on-board partner | 0–k per drone | partner image | `drone<N>` (+ `swarm` to hear its base-station half) | a partner component on board, in its drone's compose project (§4.4) |
| base-station partner | 0–k | partner image | `swarm` | a partner component on the ground side (§4.4) |
| `ground_station`    | 1     | `drone_sim/sim`      | `swarm`               | ground-station nodes (`ground_station`, `fleet_monitor`) |
| `web`    | 1     | `drone_sim/web`      | – (HTTP only)         | `viz/serve.py`: static files, `/api` proxy to SEN REST, `/spawn`, `/kill`, `/reset` (Docker socket) |
| browser  | any   | –               | – (REST/SSE only)     | three.js swarm view (`viz/index.html`); no authoritative state |

Rules:

- **One SEN kernel per process, one process per container.** A drone is one Docker Compose
  project (`docker/drone.compose.yml`, project `drone<N>`) of our core container plus its on-board
  partner containers. N drones ⇒ N identical compose projects from the same images and YAMLs; only
  `DRONE_ID` differs.
- **Every drone compose project is the same.** On-board code never hard-codes its id; it reads it from the
  flight controller object on the drone bus, and bus names come from `@env(DRONE_ID)` in the YAML.
- **The world process is the only place that knows "everything".** Nothing on
  board may depend on the sim bus except the airframe (see §4.3).

## 3. The three buses

SEN gives us sessions (namespaces that ether does or does not share) and buses
inside them. We use one session per drone plus two shared ones, one bus each: `drone<ID>.bus`,
`swarm.bus`, `sim.bus`. Ether connects only processes that open the same session. Bus names
have exactly two dotted segments (SEN query limitation); the session says which bus it is, the second
segment is always `bus`. The sim bus
holds an object named `world` (`sim.bus/world`), which is not the bus.

**Placement rule.** An object lives on `swarm.bus` if another drone or the
ground station calls or reads it; everything else stays on `drone<ID>.bus`. `flight_controller` and
the simulated `sensor` never go on `swarm.bus`. A per-drone object on `swarm.bus` is named in the
YAML `<name>_drone@env(DRONE_ID)` (the drone's vehicle face is plain `drone@env(DRONE_ID)`), like
`truth_drone@env(DRONE_ID)` on `sim.bus`, and carries `droneId : string [static]`: C++ never builds
or parses an object name, it queries by class and picks by `droneId`.

```
swarm.bus                                       drone<ID>.bus (names the same on every drone)
  ground_station, fleet_status                    flight_controller, sensor
  drone<ID>            (airframe: the vehicle)
  waypoint_navigator_drone<ID>, example_drone<ID>
  geocage (partner)                               geocage_store (partner)
```

**The air link is below SEN.** `swarm.bus` is carried by `ether` over an IP network: a mesh radio
on a real system, the Docker network here. Link quality (latency, loss, bandwidth) is not simulated; there is no radio component. A later measurement can put `tc netem` on
the Docker network to see how SEN behaves on a degraded link.

### 3.1 Drone bus — `drone<ID>.bus`

- One SEN session per drone (YAML `drone@env(DRONE_ID).bus`). Ether connects only processes that
  open the same session, so the bus holds that drone's objects and nothing else, and every
  container of the drone's compose project can join it: our core process and any on-board partner image.
- **Naming.** Every YAML that touches the drone bus writes it as `drone@env(DRONE_ID).bus` — ours
  (`config/drone.yaml`, each package's `config.yaml`) and a partner's (its image's drone YAML) —
  and every container of a drone's compose project gets the same `DRONE_ID` from `docker/drone.compose.yml`, so
  drone 5's components all meet on `drone5.bus` (SEN session `drone5`, bus `bus`; one multicast
  group per session and bus). The C++ never names a bus: it reads its `droneBus` static. Object
  names are the same on every drone (`flight_controller`, `sensor`, …), so a node finds "the
  `FlightController` on my drone bus" and gets its own drone's. What must hold: **unique positive integer `DRONE_ID`s** (the
  compose project is `drone<ID>`, so re-spawning an id reuses that project; the UI takes max id + 1;
  `run_native.sh` numbers its processes), **nobody opens another drone's bus**, and one
  `SEN_ETHER_DISCOVERY_PORT` per stack on a LAN (as for `swarm.bus`). `drone5.bus` (a session) and
  `swarm.bus/drone5` (an object) do not collide.
- **Isolation is by naming, not enforced.** SEN session `local` would be isolated (SEN guarantees it
  never leaves its process) but therefore could not hold a partner component delivered as a Docker image (`sim_spec.md` §18). A private network
  per drone is not an option: a SEN process has one ether network device and discovery port, and
  the core process joins `swarm.bus` too. So any process *could* open `drone3.bus`; ours
  don't, partners are told not to; security is out of scope. Measured: drone buses stay separate,
  a route flowed swarm → a sidecar's node → `flight_controller` across processes for 100 s with nothing
  frozen, a restarted sidecar rejoins, a sidecar costs ~0.14 core and ~9 MiB.
- Every drone has the same objects with the same names: `flight_controller`, `sensor`
  (the simulated payload) and whatever on-board nodes are loaded (partner objects
  included). A node others call (`waypoint_navigator`, `example_node`) is on
  `swarm.bus` instead (§3 placement rule).
- This is the interface partner code is written against. It must look like the
  bus on the real vehicle: a flight controller that accepts setpoints and publishes state, and
  sensors.

### 3.2 Swarm bus — `swarm.bus`

- Everything that in reality would go over the air. Drones, the ground station,
  the UI **and partner components** meet here: all drone ⇄ base station and drone ⇄ drone
  traffic is on this bus.
- Each drone's airframe publishes `drone<ID>` (`DroneLink`: the vehicle's public face, telemetry,
  envelope, heartbeat and the six flight-controller commands); its `waypoint_navigator_drone<ID>`
  publishes here itself. The ground station publishes `ground_station`.
- **Operators call the drone's objects directly.**
  The UI and our scripts invoke the command on the drone's own object on this bus:
  `drone<ID>.arm()`, `.takeoff(alt)`, `.land()`, `.disarm()`, `.goToPosition(target, speed)`,
  `.setVelocity(v)`; `waypoint_navigator_drone<ID>.setRoute(route, speed)`, `.cancel()`. The ack is the
  drone's `CommandAck`. That is the SEN pattern: find the object, call its method; no router with a
  `droneId` argument. Operator commands go over `swarm.bus` only, never to the flight controller; the UI
  reads no drone bus.
  Simulator control is separate: the clock on `sim.bus/world`, spawn/remove through `serve.py`, and
  pausing the ground station (Docker).
- Bandwidth/latency/dropout modelling is out of scope (§3: the air link is below SEN).

### 3.3 Sim bus — `sim.bus`

- God's-eye truth for rendering and scenario control. Objects: `world` (sim time,
  time scale, pause), ground assets (`tank1`, `truck1`,
  …), and one `truth_drone<ID>` per drone published by its airframe (true pose,
  velocity, attitude, health).
- Consumers: the world process (REST → UI), scenario tooling, recorders.
- The UI **renders** from the sim bus and **commands** through the swarm bus.

## 4. Inside a drone

The drone's core container runs one `sen run drone.yaml` with these components, all
single-threaded SEN components on the same kernel (our nodes stay in one process); on-board
partner components run beside it in the same compose project (§4.4):

### 4.1 `airframe` (flight_controller + kinematic flight model)

- **Kinematic 6DOF with attitude** (`sim_spec.md` §5), first airframe a
  **small tactical ISTAR fixed-wing** (parameters from YAML): airspeed between min and max, coordinated turns with a bank
  limit (turn rate = g·tan(bank)/v), climb/descent within a flight-path-angle
  limit. Attitude is derived from the motion (roll = bank, pitch = flight-path
  angle, yaw = course). Geometry, not physics: no force/torque model, no PID
  cascade. Pure functions in a SEN-free `kinematics.h`.
- **The skeleton is agnostic to the vehicle model:** no contract, node, script or config
  outside `packages/airframe` knows bank, flight-path angle, loiter or any other fixed-wing concept, so
  swapping the airframe touches `packages/airframe` only and a partner node works unchanged whatever
  vehicle is behind `FlightController`.
- Fixed-wing realisation of the generic flight controller semantics (`packages/airframe/stl/drone_sim/sim/airframe.stl`):
  it cannot hover, so `hold` and "arrived at a `goToPosition` target" mean loitering in a circle of
  the `SimAirframe` static `loiterRadius` around the point; `takeoff` is ground roll + climb-out on
  the current heading, `land` a descent and roll-out. The bank and flight-path-angle limits are
  `SimAirframe` statics too. A multirotor variant is a later extension.
- Flight controller = mode logic (disarmed / armed / takeoff / hold / goingTo /
  land) exposing the **flight controller interface** on `drone<ID>.bus/flight_controller`: arm/disarm,
  takeoff, land, position/velocity setpoints, mode, and state (pose, velocity,
  battery, status).
- **Empty battery, ground contact.** The battery drains in every mode but `disarmed` and
  `crashed`, not while paused (1800 s of endurance). At 0 in the air (or landing) the motors stop: mode `crashed`, a wings-level glide at
  `minSpeed` within the flight-path-angle limit down to the flat terrain, then speed 0 on the ground,
  and it stays `crashed` until removed or reset (§7). Every flight command answers
  `rejectedState "crashed"`; heartbeat and telemetry go on, so the ground station sees it alive
  and crashed. At 0 on the ground (armed, or still on the launch run) the drone is `disarmed`.
  Touching the terrain in `hold` or `goingTo` (a `setVelocity` sink rate) is `crashed` too, at once;
  only `land` and the launch run are on the ground on purpose.
- Start position: the `SimAirframe` statics `startLatitude`/`startLongitude`, filled from
  `START_LATITUDE`/`START_LONGITUDE` by `@env()` in the YAML (`scripts/spawn_drone.sh` passes
  `-e START_LATITUDE=… -e START_LONGITUDE=…`). Unset means the sentinel `999` (an `@env()`
  default must be `\w+`, so neither a sign nor `nan`), and drone `<n>` is then
  parked `(n−1) × 150 m` east of `World.origin`, nose north. The sentinel lives on
  the simulator-only subclass, never on the partner-facing `FlightController` contract.
- **Steps at 50 Hz, publishes at 10 Hz.** The flight model integrates every
  component cycle (`airframeComponent.freqHz`, 50 Hz) but stages properties only
  every n-th cycle (`publishRate`, 10 Hz). The step is the **measured `api.getTime()`
  delta × timeScale** — the same base `world.simTime` uses; ground assets do the same. The stamp
  `stateTime` is the world's `simTime` as last received, advanced by every step since, so it names
  the time of the position it comes with. Measured (`scripts/sim_time_check.py`, 1×, 10×, 100×,
  native and compose): `simTime` runs at timeScale ± 1 % over 10 s or more, the motion matches the stamps, a time-scale
  change leaves at most one step (20 ms) × the change between them. **The clock never waits:** a
  process stalled longer than 1 s (`kMaxWallDtS`) loses the rest, its movers stand still for it; a
  stalled world jumps its clock on return and the drones, which flew on, agree with it. No object
  reads the OS clock: `api.getTime()` is wall time in real-time mode and the stepped
  clock under `TestKernel` / `virtualTime`. 10 Hz is
  plenty for the view and costs ~0.2 core per drone. An early "50 Hz wedges the
  buses" finding did not reproduce once every REST client held one interest per
  bus (8 drones at 50 Hz for 3 min); it was most likely the interest
  bug of §9.
- True state is `sim.bus/truth_drone<ID>`, a second YAML object of the airframe
  component that subscribes to `flight_controller` and mirrors `flight_controller.state` (one cycle of lag,
  invisible to the view); `flight_controller` reads `sim.bus/world` for origin, time scale and pause. The airframe is the *only* on-board component allowed on the sim
  bus, because it represents the physical airframe, not software.
- The vehicle's public face is `swarm.bus/drone<ID>` (`DroneLink`), a third YAML object of
  the airframe component built the same way as `truth_drone<ID>`: it subscribes to `flight_controller`,
  mirrors `state` as `telemetry` and `envelope`, and forwards `arm`, `disarm`, `takeoff`,
  `land`, `goToPosition`, `setVelocity` (deferred methods: the ack is the flight controller's). Its
  `heartbeat` is its own (10 Hz while the flight controller is there). It
  exists because `flight_controller` stays off the shared bus: a real vehicle would never expose its
  autopilot to the whole mesh. No node status, no node commands: those are the nodes' own objects.
- Terrain: flat plane at the scenario origin (`World.origin`) initially; later a height map shared
  with the world process (same file baked into both images). The flat world is the simulator's
  (`World`, `SimAirframe` comments), not a contract convention; on board the AGL datum is
  `flight_controller.homePosition`.

### 4.2 `radio` (none)

There is no radio component: its duties live on `swarm.bus/drone<ID>` (published by the airframe,
§4.1) and on the nodes' own objects on `swarm.bus` (placement rule, §3).

### 4.3 On-board nodes (the future ERA2-architecture components)

- Plain SEN components, one `.stl` interface each, publishing on the drone bus
  and subscribing to `flight_controller` and each other.
- A node publishes on `swarm.bus` when another drone or the ground station calls or reads it (§3
  placement rule: `waypoint_navigator`), and reads `swarm.bus` for what comes
  over the air (other drones' `DroneLink`, the `GroundStation`). Everything else of a node stays on
  the drone bus. Whether the flight controller behind it is our kinematic model or a real autopilot
  is invisible to them — that is the transfer guarantee.
- Loaded by one `include:` line of the node package's `config.yaml` in `config/drone.yaml`, the one drone config; nothing else changes.
- **Simulated sensors** (`packages/nodes/sim_nodes/`, first: `imaging_sensor`, the
  ISTAR payload) are the second exception to the sim-bus rule: like the
  airframe they stand in for hardware, so they may *read* `sim.bus` (ground
  asset truth) and publish what the hardware would deliver (`sensor` object
  with `tracks`) on the drone bus. Their drone-bus interface is part of the
  partner-facing contract; their implementation is replaced on a real vehicle.
- Shipped with the skeleton (`sim_spec.md` §6): `example_node` (copy-and-modify
  template, `swarm.bus/example_drone<ID>`: reads `flight_controller`, publishes `position`, takes
  `setMessage` over the air) and `waypoint_navigator` (`setRoute(Route)`, drives `flight_controller.goToPosition()`,
  publishes progress, emits an `arrived` event).
- **Our control paths are temporary scaffolding.** The operator commands on
  `swarm.bus/drone<ID>` and `waypoint_navigator` exist to exercise the skeleton and will be replaced:
  the partners' on-board nodes (navigation, DAA, ACEM, route replanning, mission management) will fly
  the drone autonomously through `FlightController`. That contract is what lasts. There is no
  arbitration between commanders: any node may command the vehicle and the last command wins;
  priorities are the partners' design (e.g. ACEM).
- The ERA2 components (WP4000 / WP5000) are the partners'. There are no stand-ins of ours for them, so the core
  process runs the skeleton only. A delivered component runs in its own container (§4.4); its
  consumers read the partner class, never a `Sim*` class of ours. The partner-component map (the
  `.stl` files come from the partners' repositories, unpacked or cloned into git-ignored
  `external/wp4000/` (target `wp4000`) and `external/wp5000/` (target `wp5000`); they are not in this
  repository and not open source, and the build skips a missing one; tested commits are
  pinned in `README.md`; a fix to a partner `.stl` goes upstream via the WP4000 maintainers, never as an edit
  under `external/` (open: WP5000's bare `import "aucc_types.stl"` → `stl/aucc/…`, blocks building it as an SDK target);
  where the map and a `.stl` disagree the `.stl` wins):

| Component (partner) | Partner class / types | Would run | Reads (what our skeleton offers) |
|---|---|---|---|
| Flight Dynamics Model (WP4000) | `aircraftera.ModelFlightDynamics` | on board, `drone<ID>.bus` | `flight_controller` (state, envelope); `waypoint_navigator_drone<ID>` route |
| Trajectory Predictor (WP4000) | `av_confinement.TrajectoryPredictor` | on board | `flight_controller` (state, `homePosition`); the route; `ground_station.heartbeat` (C2 liveness) |
| Airspace Monitor (WP4000) | `av_confinement.AirspaceMonitor` | on board | the predicted trajectory; the airspace (`sim.bus/world` `airspace` stands in for a loaded file) |
| ACEM (WP4000) | `acem_package.ACEM` | on board | Airspace Monitor events; `swarm.bus/ground_station` `heartbeat` |
| Route Replanning (WP4000) | `route_replanning.RouteReplanning` | on board, called by ACEM (unconfirmed: the WP4000 maintainers ask the partners) | a waypoint graph and start/target written by its caller; its `currentRoute` would feed `waypoint_navigator_drone<ID>` |
| Manage Mission (WP5000) | `aucc` message structs (no class; `aucc_manage_mission.stl`) | on board, `swarm.bus` side for what others call | `ground_station`, other drones' `DroneLink`, ACEM; commands via `waypoint_navigator` / `flight_controller` |
| Create Route (WP5000) | `aucc.PlannedRoute` (`aucc_create_route.stl`) | on board | `flight_controller` (envelope, `homePosition`) |
| DAA (WP5000) | `aucc` DAA structs (`aucc_daa.stl`) | on board | `flight_controller` state; other drones' `DroneLink.telemetry` on `swarm.bus` |

### 4.4 Partner components: built from source at the partner, handed over as images

**Partners develop from source; they hand over images.** At its own site a partner builds its
component from source against the partner SDK (`FROM drone_sim/sim`, `find_package(drone_sim)`),
runs it in our stack and iterates. What it shares with us is most likely only the built Docker image
plus the `.stl` (`sim_spec.md` §18); a source delivery is the exception. **A partner component always
runs in its own container, so either delivery is the same compose block**, with or without a
`build:` line:

| Delivery | In the repo | How it runs |
|---|---|---|
| Our node | `packages/nodes/<group>/<name>/`, one line in `packages/CMakeLists.txt` | in the core process: an `include:` line of its `config.yaml` in `config/drone.yaml` (or `ground_station.yaml`) |
| Our template as a partner container (`example_node`) | the same folder, plus a `Dockerfile` and `drone.yaml` (the shape of `examples/partner_geocage/`); its `CMakeLists.txt` also builds stand-alone against the SDK | the service `example_sidecar` in `docker/drone.compose.yml` (`build:` of the folder, profile `example_node`): a second object of the class, `swarm.bus/example_sidecar_drone<ID>`, beside the core's `example_drone<ID>` |
| Our stand-in for a partner component (none now) | `packages/nodes/drone_nodes/<name>/` | in the core process: an `include:` line in `config/drone.yaml`, until the partner's arrives |
| Partner interface library (WP4000, WP5000) | `external/wp4000/`, `external/wp5000/`: the partner's repository (git-ignored), its `.stl` files and its `CMakeLists.txt`: one STL-only target (`wp4000`, `wp5000`) with no `DEPS`, added before `interfaces/` only if present (configure stops on a WP4000 older than 2026-10-06 that still imports RPR); built by native builds only: `.dockerignore` keeps all of `external/` out of our image | no process, *not in our image*: a partner component that needs the WP types builds them in its own image |
| Partner, image | `external/<name>/`: README (image tag, contract version), the `.stl` (+ our `CMakeLists.txt` only where our code reads it typed: none now) | a compose service `image: partner/<name>:<version>`, `pull_policy: never` |
| Partner, source | the same `external/<name>/`, plus `source/`: the partner's folder as delivered (the shape of `examples/partner_geocage/`) or a git submodule | the same compose service plus `build:` of `external/<name>/source` |

- **Names (partner-facing, fixed).** `<name>` is the delivery's name in whole
  words: the `external/<name>/` folder, the image `partner/<name>:<version>`, the folder in the
  image `/partner/<name>/` with `drone.yaml` (on board) and `base.yaml` (base station), and the
  compose profile: every service of it carries `profiles: [partners, <name>]`, so
  `COMPOSE_PROFILES=<name>` runs one component and `COMPOSE_PROFILES=partners` all of them. A
  service is named after the object it runs (the example: `geocage` at the base station,
  `geocage_store` on board).
- **Placement.** **On board** a component is one service in `docker/drone.compose.yml`, sharing the
  core's network namespace (`network_mode: service:core`) and joining `drone@env(DRONE_ID).bus`;
  **at the base station** it is one service in `docker-compose.yml` on `swarm.bus`.
- **Source delivery.** The service gets `build: { context: <path>/external/<name>/source, args:
  { DRONE_SIM: drone_sim/sim } }` next to its `image:`: the partner's own Dockerfile, `FROM` the
  `drone_sim/sim` just built, so it always matches our contracts. `.dockerignore` keeps
  `external/*/source/` out of our image. The `.stl` in `external/<name>/` is the verbatim copy of the
  one in `source/`, as for an image.
- **Builds happen in `scripts/up.sh` only, one at a time:** `drone_sim/sen-base` → `drone_sim/sim` →
  `drone_sim/web` → every active partner service with a `build:`, in both compose files (two C++
  builds side by side run a small VM out of memory). Starting a drone (`spawn_drone.sh`, the UI's
  `/spawn`) never builds (`--no-build`; the web container has no build context anyway).
- **In its own container, whatever the delivery.** Moving a partner component into the core process
  later is a performance option (a YAML `include:` and a CMake line), not a redesign.
- **Replaceability.** Every consumer of a component subscribes to the class a replacement must
  implement: the partner class (e.g. `av_confinement.TrajectoryPredictor`) or a bus contract class
  of ours in `interfaces/`, never to a `Sim*` class of a stand-in.
  The map in §4.3 names that class per component.
- **Retiring a stand-in** (a rule; no stand-in exists now). The change that adds partner component X
  removes X's stand-in `include:` line from `config/drone.yaml` in the same commit: two implementations of one component on one bus is an
  error (every consumer would see both). Compose cannot say "the stand-in or the partner's" at
  runtime; the swap is one integration commit per delivered component, on purpose.
- **A component whose profile is off is absent.** Consumers tolerate it (an empty subscription
  list); the UI and the ground station see the node's object missing, since they read the node
  itself (there is no status mirror on `DroneLink`). Checked: without a profile `smoke.sh`
  and `/reset` pass; a killed partner container stops nothing else of its drone.
- **Our examples carry a `build:`** (`examples/partner_geocage`, `example_node`): their source is in
  this repo, so `COMPOSE_PROFILES=partners` works on a clean clone; a delivered image has none.
- **Talking to its other half: over `swarm.bus`.** An on-board partner
  container may open `swarm.bus` (its air link) as well as its drone bus and publishes by the §3
  placement rule (on `swarm.bus` only what others call or read, named `<name>_drone<ID>` with a
  `droneId`); a base-station one publishes on `swarm.bus`. No bridge of ours is in the path, so a
  partner delivery needs no change of our code or contract. Otherwise the same rules as our nodes:
  tolerate peers that appear late (containers start in any order; YAML `group:` orders only within
  a process); one query per class per process (§8; a container with one typed interest per bus is safe). A partner that keeps its source hands over the
  image and the `.stl` (`sim_spec.md` §18); one that shares it hands over the folder its image is
  built from.
- The `.stl` is kept verbatim in `external/<name>/` as the interface document, and built by us only
  where our code reads the component typed (none now: `external/<name>/CMakeLists.txt` then); REST
  and the UI read any remote object without it. The image carries our contract version
  (`/opt/drone_sim/VERSION`, below), a label: nothing checks it. A `.stl` comment edit costs nothing; a
  type change costs one number in `interfaces/VERSION` and one line in `CHANGING.md`, and whoever runs
  a partner image built before it rebuilds it when `CHANGING.md` says the type changed (SEN converts
  mismatched types silently).
- **One version number.** The release version is the contract version: a release is the git tag
  `v<VERSION>` with `<VERSION>` from `interfaces/VERSION`, and `CHANGELOG.md` uses the same number.
  A release without a contract change still bumps the last digit, so the tag, the image tag
  `drone_sim/sim:<VERSION>` and the release file never disagree.
- **The partner SDK is `/opt/drone_sim` in `drone_sim/sim`**, and nothing a partner uses
  lives outside it: `/app` is ours to reorganise. It is a contract like the `.stl` files (§8),
  changed only with a version bump:

  ```
  /opt/drone_sim/
    VERSION                       contract version (source: interfaces/VERSION)
    cmake/drone_sim-config.cmake  find_package(drone_sim REQUIRED) (the image sets CMAKE_PREFIX_PATH=/opt/drone_sim):
                                  target drone_sim_interfaces
    interfaces/                   the .stl files (import paths "stl/drone_sim/…")
    config/ether.yaml             the transport block every SEN process includes
    lib/                          our interface library (libdrone_sim_interfaces.so), on LD_LIBRARY_PATH;
                                  no partner library
  ```

  `find_package(drone_sim)` adds the installed interface directories (`add_subdirectory`, outside
  `all`), so the partner generates the same code from the same files; SEN's
  `get_external_interfaces` would need exported CMake targets, which `add_sen_package` does not
  create. A partner YAML starts with `include: [/opt/drone_sim/config/ether.yaml]`; ours include the
  same file (`config/ether.yaml`). Two rules:
  1. **One build of the ERA2 types, in the partner's image.** Our SDK holds only our contracts:
     no WP4000/WP5000 `.stl` and no `libwp*` (closed files). A partner component that
     needs them builds `wp4000`/`wp5000` in its own image from the pinned partner commit
     and never adds a copy of one of our `.stl` files: at runtime every type of ours comes from
     `/opt/drone_sim/lib` (a second copy of a type registers twice, or differs silently). A
     WP4000/WP5000 `.stl` change lands in that partner's repository (`external/wp4000`,
     `external/wp5000`); the partner `.stl` files are versioned by that repository's commit, pinned
     in `README.md`, not by `interfaces/VERSION`. Everybody rebuilds on a new pin.
  2. **Image tag = contract version**: `drone_sim/sim:<VERSION>` (`scripts/up.sh` tags it; plain
     `drone_sim/sim` is the local alias the compose files use). `scripts/release.sh` writes it to
     one file for partners who load it instead of building `sen-base` and `drone_sim/sim`.
- Our own nodes stay in the core process: a container per node would be ~12 kernels per drone and
  expose every interest to the §9 kernel bug, for uniformity only.
- The template partners copy: `examples/partner_geocage/`: a geocage service at the base
  station (`swarm.bus/geocage`), a store on board each drone (`drone<ID>.bus/geocage_store`) that
  hears it over `swarm.bus` and holds the last one; one image, nothing of ours changed to add it.

## 5. World process

- `world` component: sim clock (`simTime`, `timeScale`, `paused`; `simTime` integrates
  the measured `api.getTime()` delta × the rate published the cycle before, so a `setTimeScale` or
  `pause` counts from the cycle that receives it, as in the drones), origin, airspace.
  Ground assets (tank, truck) are plain YAML objects of the same component
  (`world.GroundAssetImpl`, one block each in `config/world.yaml`), kinematic
  path followers on flat terrain, published on `sim.bus`; adding one is
  copying a block.
- Airspace: `world.airspace` (`Airspace [static]`) is the geocage,
  no-fly zones and altitude band, written in `config/world.yaml` like `origin`
  (no file, no reader, no `AIRSPACE` env: one airspace exists).
  Display only; compliance checking is the partner's (`av_confinement.AirspaceMonitor`).
- `rest` component (SEN built-in): the browser's gateway. Because the world
  process joins both `sim` and `swarm`, the UI can render truth and command drones
  through one endpoint.
- `ether` with SEN's **default multicast discovery** on the compose network
  (`SEN_ETHER_ALLOW_VIRTUAL_INTERFACES=true` in containers). The TCP discovery
  hub is a documented fallback for platforms where multicast does not work
  (Docker Desktop on macOS, multi-host); it is one YAML block, not a topology.

## 6. Ground station

- Its own container, joins **only** `swarm`. Publishes `swarm.bus/ground_station`.
- Same code path as any real ground station: it sees drones exclusively through
  what they publish on `swarm.bus` (`drone<ID>`, `waypoint_navigator_drone<ID>`).
- `GroundStation` is `heartbeat : u64` only: the base station's liveness (C2 link), read on board by a
  partner component. Pausing the ground station stops it (C2 loss). It forwards no commands:
  operators call the drone's objects directly (§3.2). If C2 policy is ever needed
  (authorisation, deconfliction, a command log), it comes back as a ground-station node that does
  something, not as a pass-through. `ground_station` itself holds no interest; the process's one
  `swarm.bus` interest is `fleet_monitor`'s `SELECT drone_sim.DroneLink`.
- Example ground station node `fleet_monitor`: typed interest on `drone_sim.DroneLink`,
  heartbeat-timeout liveness, publishes `swarm.bus/fleet_status`. A drone whose
  `DroneLink` disappears stays in the list as lost until it reappears.
- **Why liveness is heartbeats and not SEN presence alone** (measured on the
  native stack at the pin): a *dead* process (`kill -9`) is gone from every
  subscription within 0.5 s (TCP close), so for that case the heartbeat adds
  nothing. A *silent but connected* process (`SIGSTOP`; the shape of a real
  link loss) is different: ether's beam tracker reports the loss after 3 s
  (`beamExpirationTime` = 3 × 1 s) but the objects stay in the subscriptions
  (none removed in 120 s), while the 3 s heartbeat timeout (`lostAfter`) catches it in 2.9–3.5 s. So `heartbeat` stays on
  `DroneLink` (counted by the link itself, not by `FlightController`) and
  `GroundStation` until presence covers the silent case.
- No mission contract: a one-drone mission is a route (`setRoute`, `arrived` = done);
  mission planning and escalation reactions are the partner's. Losing the ground station is still
  real: stopping or `docker pause`-ing its container stops its heartbeat.

## 7. UI

- Browser, three.js r183, Preact 10 + htm 3.1.1 and fonts vendored
  (`viz/vendor/VENDOR.md`), ES modules + import map, no bundler, no npm (Node
  only for `node --test`). An orthographic "architect's model" of the theatre:
  no globe, no 3D tiles, no imagery. Everything UI lives in `viz/`; nothing
  outside it knows the UI exists.
- **No API keys, no accounts, anywhere** — the project is meant to be shared, so
  anything that needs a token is out (MapTiler, Google 3D Tiles).
- Terrain comes from **committed per-area files** under `viz/data/<area>/`,
  fetched once by `viz/fetch_area_assets.py`: the theatre DEM (60 × 40 km, 30 m,
  Copernicus GLO-30) + OSM land cover, no buildings. No runtime terrain service;
  no request leaves the origin. `viz/data/index.json` must always exist: a 404
  is a console error the page cannot suppress.
- **The flat sim over a bumpy map.** The sim's ground is the origin's altitude
  and every published altitude is metres above that one plane. The UI therefore
  draws a *flying* thing at `groundH + altitude` (`groundH` = DEM height at the
  origin) and a *ground* thing clamped to the DEM under it. A drone flying low
  over a hill the sim does not model is inside that hill; this is accepted, not a
  rendering bug, and is fixed sim-side later, never in the renderer.
- Served by `serve.py`, a small static server that reverse-proxies `/api` to
  SEN REST (same-origin, avoids CORS and the known REST/TCP-segment issue), with
  `Cache-Control: no-cache` on every response.
- Drones are compose projects, started and removed at runtime: `scripts/spawn_drone.sh <id> [lat lon]` runs
  `docker compose -p drone<id> -f docker/drone.compose.yml up -d` (`DRONE_ID` and start position
  via env), `… --profile '*' down` removes the whole compose project (every profile: a plain `down` leaves the
  partner containers of an inactive profile); `scripts/up.sh [N]` starts world, ground_station, web and N
  drones. From the UI: **spawn** → click on the map → `serve.py` `/spawn` runs the same
  compose command (`web` carries the Docker CLI and mounts the socket; a dev tool) → the drone joins
  `swarm.bus` by SEN's ordinary multicast discovery in ~1 s. **Remove** → `/kill` takes the drone's compose project down.
  Docker-only; in native runs the drone count comes from `run_native.sh`.
- **Reset**: "Reset simulation" → `serve.py` `/reset`, an ordered restart under the lock
  `/spawn` and `/kill` hold (busy → 409): (1) every drone compose project down, (2) `docker stop` the
  base-station containers except `world` and `web`, (3) `docker restart` `world`, wait for REST,
  (4) start the stopped ones again (partner services included), (5) spawn the drones of
  **`scenarios/initial.yaml`, the one definition of the initial state** (drones and starts; its
  `expect` is the check, `scripts/scenario.py initial [--check]` the shell equivalent). Nothing
  rejoins a running `world` (a known SEN crash path at the pin,
  `patches/sen/upstream-core-property-connection-remove-segfault.md`). No in-process reset: it would need a reset
  method on every node and a contract change, and could not reset partner containers; a restart
  gives the true start state. Pages reconnect with a fresh id and drop their page memory (routes,
  draft, selection) when `world.simTime` goes backwards. Each page's SSE stream carries its own token
  (`/api/sse?token=`, which `serve.py` turns into SEN's cookie), so tabs reconnecting together keep
  their own sessions; while a reset runs, the proxy retries a failed REST request instead of a 502.
- Subscribes via SSE to `sim.bus` for rendering (`World`, `DroneTruth`, `GroundAsset`), to `swarm.bus`
  (`DroneLink`, `FleetMonitor`, `GeocageService`, `WaypointNavigator`); no drone bus; one `SELECT * FROM <bus>` per bus (§8). Every drone command is
  a method on the drone's own object on `swarm.bus`, `drone<ID>` or `waypoint_navigator_drone<ID>` (§3.2);
  the only other invokes are simulator control on `sim.bus/world` (pause, resume, time scale).
- Holds no authoritative state; every drawn thing comes from a SEN object. The
  only browser-side draft is the waypoint list being clicked together before it
  is sent with `waypoint_navigator_drone<ID>.setRoute(route, 0)`.

## 8. Interfaces (`.stl`) — the contract

**Bus contracts live in `interfaces/`; a node's own `.stl` lives in the node's own
package** — exactly as SEN's examples do it (`my_counter` carries
`stl/my_counter/counter.stl`; `terrain_server` imports shared types from
`hla_fom` through `DEPS`). The rule that decides which is which: **if another drone, the ground
station or a node in another package calls or reads it, its interface is a bus contract in
`interfaces/`**, and the node implements it (`WaypointNavigator` by `waypoint_navigator`, like
`FlightController` by `airframe`). A node that only its siblings use keeps its `.stl`. So
every node depends on `drone_sim_interfaces` (`example_node` and `fleet_monitor` on nothing else);
`waypoint_navigator` and `imaging_sensor` add `drone_sim_common` for `geo.h`/`sen_helpers.h`. No node links
another node's package (`PUBLIC_SYMBOLS` is on the interface packages only).
The skeleton contract (`drone_sim_interfaces`) has no partner dependency; the ERA2-architecture
contracts are the partners' own. `swarm.bus` carries no partner type. So:

```
interfaces/                     the `drone_sim_interfaces` package: the skeleton's bus contracts only
  stl/drone_sim/common/types.stl       GeoPosition, GeoPositionList, Route, NavigatorStatus, Vec3, Quaternion, FlightMode, CommandAck
  stl/drone_sim/drone_bus/             flight_controller.stl (VehicleState, AirframeEnvelope, FlightController), sensor.stl (Track, Sensor), CHANGING.md
  stl/drone_sim/swarm_bus/             drone_link.stl (DroneLink: the vehicle face)  ground_station.stl
                                  waypoint_navigator.stl (WaypointNavigator): called by the ground station, the UI and
                                  siblings; implemented by packages/nodes/drone_nodes/waypoint_navigator
  stl/drone_sim/sim_bus/               world.stl  ground_asset.stl  truth.stl
external/wp4000/stl/            the WP4000 .stl files (aircraftera, av_confinement, acem, route_replanning), from the WP4000 repository (git-ignored, §4.3)
external/wp5000/stl/aucc/       the WP5000 aucc .stl files, from the WP5000 repository (git-ignored, §4.3)
packages/<pkg>/stl/drone_sim/<group>/x.stl   one package's own interface, built by that package
  packages/airframe/stl/drone_sim/sim/airframe.stl     SimAirframe (the simulator's own knobs), SimDroneTruth, SimDroneLink (+ droneBus)
  packages/nodes/…/stl/drone_sim/nodes/<node>.stl      a node's drone-bus interface that only siblings use
```

A `Sim*` class that only adds statics
(`SimDroneLink : extends DroneLink` with `droneBus`) stays in the implementing package: other
processes call only the parent's methods, which they know from `drone_sim_interfaces`.

The `stl/drone_sim/…` folders mirror the import path, which is SEN's rule for
interfaces that can be exported and consumed elsewhere
(`airbus/sen/docs/howto_guides/exportable_interfaces.md`): a node imports
`"stl/drone_sim/common/types.stl"` and includes `"stl/drone_sim/drone_bus/flight_controller.stl.h"`,
and generic names like `common/types.stl.h` cannot shadow another project's.
A package gets the shared types by listing `DEPS drone_sim_interfaces`, which
propagates both the codegen import path and the generated include directory.

The folder under `stl/drone_sim/` names the group the class belongs to, exactly as in
`interfaces/`: `nodes` for a node's drone-bus interface, `sim` for something only
the simulator has.

A package may also *extend* a contract class for its own knobs: the simulator's
airframe package defines `SimAirframe : extends FlightController` with the simulator-only
statics (`simBus`, `publishRate`, `launchAcceleration`, the fixed-wing limits), so `FlightController` stays free of simulator
knobs while a typed interest on `drone_sim.FlightController` still finds the object. SEN generates
`SimAirframeBase<P>`, a template over the parent's implementation, as in
`airbus/sen/examples/packages/animals`.

Type changes are runtime-incompatible across processes: rebuild and restart all
images together (SEN's compatibility conversions make mismatches *silently
lossy*, not loud). On our core contracts and on anything that crosses a bus
(swarm, sim, browser), every mutation is a **method invoke that returns
`CommandAck`**; the browser never writes properties. Between nodes on the same
drone bus, `[writable]` properties are an accepted SEN pattern (partner nodes
use them); prefer a method when the caller needs an ack or validation. SEN
`event`s are used for asynchronous notifications.

Vehicle state is **one struct property**, not a dozen loose ones:
`FlightController.state` and `DroneTruth.state` are `VehicleState`, `DroneLink.telemetry` is the
same struct. Committed as one value in one cycle, a reader never sees a position
from one cycle next to an attitude from the next; that comes from the struct, not
from the transport, so the three are best-effort, SEN's documented choice for a
high-rate latest-value stream (`[confirmed]` stays for what is published once or
on change, and for every unbounded sequence). The derived fields partner telemetry expects
(`heading`, `course`, `groundSpeed`, `verticalSpeed`) are computed once, by the
publisher. `heading` is the **nose heading** (the yaw of `attitude`) and
`course` the **track over ground** (from the horizontal velocity), both degrees
clockwise from north; they can differ (sideslip, a crosswind, a vehicle that
moves sideways), so both are published rather than one standing in for the other.
`FlightController.homePosition` is the launch/home position, its `altitude` being the **ground
altitude AMSL** at that point, so a node on the drone bus can convert AGL↔AMSL
without reading the sim bus (§4.3 forbids nodes there); `takeoff(alt)` is metres
AGL above `homePosition.altitude`. It is a plain property and not a `[static]`
because SEN statics are YAML-only constants while the home position is only
known once the world origin has been discovered.
**Contracts carry only what any vehicle has:** a field, command or comment that holds
only for one airframe type (bank, flight-path angle, loiter, "cannot stop") belongs to that airframe's
own `.stl` (`SimAirframe`), never to `interfaces/`.
The airframe envelope is one `AirframeEnvelope` struct carrying resolved values
(no "0 = built-in default" sentinel): speeds (`minSpeed`, `cruiseSpeed`, `maxSpeed`) and
`arrivalRadius` (within this horizontal distance a target counts as reached), a `[static]` on `FlightController`, mirrored once by the
link into `DroneLink.envelope` (`[confirmed]`, like `homePosition`) so a ground station
can plan inside the vehicle's limits; a static there would have to be known when
the link object is built from YAML, before the flight controller is. The
publisher validates it once, when the statics are applied, together with its own
model statics: `minSpeed` at least 1 m/s, `minSpeed <= cruiseSpeed <= maxSpeed`; for the fixed wing the
`SimAirframe` statics `maxBankDegrees` must lie in [1, 79]°, `loiterRadius` must fit the tightest
coordinated turn at cruise, and `arrivalRadius` must be greater than `loiterRadius` (YAML: 100 and 80).
A violation is refused, never clamped: the flight controller does not start and logs one line naming
the value and its flyable limit, because the published static must be what is flown.
Bus names are `[static] string` properties filled from YAML, never C++ literals.

Where our types overlap with the partner `.stl`s (waypoint, route) they are kept
field-compatible, in our own `drone_sim` package (`sim_spec.md` §14): `GeoPosition` is
`{latitude, longitude, altitude}`, the three fields of `aucc.Waypoint`.
**One interest per shared bus per process — a workaround, not a SEN pattern:** it
works around the kernel bug at SEN `05da288e` described in §9 (the single full
description) and is removed when upstream fixes it. Every REST client (the viz,
`smoke.sh`) reads a shared bus with the same untyped `SELECT * FROM <bus>` and
dispatches on the object's `className`; in-process components hold one interest per
shared bus too (`fleet_monitor` on `swarm.bus`, the airframe on `sim.bus`). Two
*different* interests that match the same **remote** object inside one process freeze
that object's updates in the pinned SEN, and every REST client shares the world
process. The drone bus is not exempt: with a partner container in the compose project,
some of its objects are remote. Our nodes hold one typed interest per class, the same query
string in every component (the airframe's two mirrors and every drone node all `SELECT drone_sim.FlightController`), which the bug
does not touch; a partner process must do the same — one query per class, no `SELECT *` beside a
typed query, no parent-class query beside ours, no `WHERE` beside a plain class query.
**On `swarm.bus` the drone process holds no interest** (it publishes there; its nodes are
called, they do not call). A drone node that reads `swarm.bus` keeps one string per class, shared by
every component of the process, matches every drone's object and picks its own in code by `droneId`
never by a `WHERE`.
**The ground station process** holds one `swarm.bus` interest, `fleet_monitor`'s `SELECT
drone_sim.DroneLink` (`ground_station` forwards nothing and holds none).
**Lock order: drone bus, then shared bus.** SEN runs `registered()` holding the
object's session lock, so an object on `swarm.bus` or `sim.bus` (`drone<ID>`, `truth_drone<ID>`,
`waypoint_navigator_drone<ID>`) never opens `drone<ID>.bus` in
`registered()`; it opens it in its first `update()` (and tolerates a method call before that).
Drone-bus objects may open shared buses in `registered()`. Otherwise two components deadlock the
process (§9).
Two typed interests whose object sets are *disjoint* are also safe on a shared bus
(the bug needs one object matched twice): the drone process holds
`SELECT drone_sim.World` (airframe) and `SELECT drone_sim.GroundAsset` (`imaging_sensor`) on
`sim.bus`. A `SELECT *` next to either is not. Conventions: SI units, lat/lon deg, altitude m AMSL, heading deg
clockwise from north, NED body frame. The flat world around one scenario origin is a simulator
property (§4.1, §5), not a contract convention; no skeleton contract names the UI, `World` or
a stand-in as its reason.

**Naming.** Partners read our names before our documents, and a
rename after hand-over costs every partner a rebuild, so every name a partner sees is readable on
first sight:

1. **Whole words** in every name a partner sees: STL types, fields, methods, parameters, enum
   members, YAML object and component names, packages, folders, compose services, images, config
   files, env vars, and identifiers in our reference code (`position`, not `pos`; `message`, not
   `msg`). The allowed short forms are a closed list in `docs/GLOSSARY.md`: software words everybody
   knows (`id`, `ack`, `api`, `rest`, `json`, `yaml`, `url`, `Hz`), SEN's own names (`sen`, `stl`,
   `ether`) and partner-defined names used verbatim (`ACEM`, `AUCC`, `ERA2`, the partner packages,
   their field names and typos). The project prefix is **`drone_sim`**: STL package, C++ namespace,
   `stl/drone_sim/…` folders, CMake targets, images, network, labels, env vars (`DRONE_SIM_ROOT`).
2. **Units: SI** is the default and is written in the comment; the name says the quantity
   (`lookaheadTime`, `range`, `separation`). Only a non-default unit or datum is in the name,
   spelled out (`maxBankDegrees`, `fieldOfViewDegrees`, `takeoff(altitudeAboveGround)`).
3. **Object names** say the role in `snake_case` whole words (`flight_controller`,
   `ground_station`, `waypoint_navigator`, `fleet_status`); where the partner's class is an
   acronym we use their name (`acem`). The vehicle's flight controller is `FlightController`, its
   snapshot `VehicleState`.
4. **Every `.stl` file opens with a comment that expands every partner acronym it uses**; the
   glossary lists them with their source, and says so where the partners' material gives no
   expansion.
5. `scripts/check_names.py` (run first by `scripts/smoke.sh`) fails on a known short form in our
   `.stl` names, YAML keys and object names and compose services unless the glossary allows it.

## 9. Deployment and portability

- **One base image** `drone_sim/sen-base:<SEN commit>` containing the SEN runtime,
  codegen and CMake config, pinned to a SEN commit (Ubuntu by digest, Conan
  deps by lockfile) and built once per machine from `Dockerfile.sen-base` by
  `scripts/up.sh` when missing. A registry copy is deferred: the release file
  (`scripts/release.sh`) does the job without one; the `SEN_BASE` build arg is the hook
  if that changes. Every service image is `FROM` it and compiles this repo's packages.
- **`drone_sim/sim:<VERSION>` is also the partner SDK** (`/opt/drone_sim`, §4.4).
  `scripts/release.sh` writes it to `dist/drone_sim-sim-<VERSION>.tar.gz` (`docker save | gzip`,
  sha256 printed): a partner `docker load`s that file instead of the ~90 min of `sen-base` and
  `drone_sim/sim` builds, and `scripts/up.sh` runs the loaded image as it is when
  `drone_sim/sen-base` is missing (a loaded image of another version is named before a full build
  starts). The image holds no `external/` and only the libraries of the current build (`rm -rf lib`
  before the cached build relinks), so the file carries no closed partner file. How the file reaches partners is open; it is the same kind of file partners hand us.
- **Two hand-written compose files**, no generation step: `docker-compose.yml` (`world`, `ground_station`,
  `web`, base-station partner services) and `docker/drone.compose.yml` (one drone's compose project: `core` +
  on-board partner services; `DRONE_ID` via environment, `hostname` set so SEN identifies
  participants correctly). `scripts/up.sh [N]` brings up the first and N compose projects of the second;
  further drones through `scripts/spawn_drone.sh` or the UI. Target scale: ~10 drones on one
  laptop (stress run 2026-09-21: 10 drones ≈ 4.5 of 8 cores; one partner container per drone
  adds ~0.14 core each).
- **Known SEN issue at the pinned commit (root-caused 2026-09-22):**
  when two *different* interests in one process match the same remote object
  (e.g. `SELECT * FROM sim.bus` beside `SELECT drone_sim.DroneTruth FROM sim.bus`),
  that object's updates stop for that process 5 s later, for good. It is a
  kernel regression (shared proxy per object, 2026-09-03): the second interest
  starts a resolution timer that nothing stops, so the timeout rejects the
  publication. Not compose-specific — the native stack only escaped it because
  it ran an older local SEN checkout. Workaround, stated in §8 and at every site that applies
  it (`packages/nodes/README.md`, `packages/nodes/sim_nodes/README.md`,
  `scripts/smoke.sh`, `scripts/scenario.py`, `viz/app/sen/feed.js`, `sim_spec.md`): one
  interest per shared bus per process, or typed interests with disjoint object
  sets. Exit condition: remove the rule and those sentences when upstream fixes
  the bug (check `main` for the resolution-timer fix before the next SEN bump;
  the report is `patches/sen/upstream-kernel-overlapping-interests-freeze.md`).
- **Known SEN hazard at the pinned commit (found 2026-09-30):** `LocalParticipant::add()`
  calls the object's `registered()` inside the session lock of the object's bus, and opening another
  bus there takes that bus's lock. An object on `swarm.bus` opening `drone<ID>.bus` while a
  `drone<ID>.bus` object opens `swarm.bus` is an ABBA deadlock: the whole process stops exchanging
  bus traffic (timing-dependent). Workaround: the lock-order rule in §8. The report is
  `patches/sen/upstream-kernel-registered-cross-session-deadlock.md`.
- **Known SEN hazard at the pinned commit (found 2026-09-30):** a REST invoke whose argument has the
  wrong shape (a JSON object for a `Vec3`) aborts the process hosting `rest` (the world): "var is not a
  sequence", uncaught. Workaround: the UI and scripts send only the shapes their tests pin
  (`viz/test/commands.test.js`). The report is `patches/sen/upstream-rest-invoke-bad-argument-crash.md`.
- Runs on Linux and WSL2 with Docker: clone, `scripts/up.sh`, open `http://localhost:8000`.
  macOS and Docker Desktop are untested (`README.md`, Platforms).
- Native run (no Docker) is supported for fast iteration: the same YAML files,
  one `sen run` per process, launched by a short script. Docker is packaging,
  not a different architecture.
- Multi-host later: point `hubAddress` at the world host; nothing else changes.
- **SEN version: upstream `main`, pinned by commit, built from source inside
  the base image.** The native install `$SEN_INSTALL` is that same build,
  copied out of the image, so native and compose runs are the same
  SEN. The local SEN checkout is older than the pin and is only used for
  docs; it carries v3's three patches, of which the REST fix is already
  upstream, the CMake one is avoided by following SEN's canonical package
  pattern (no `EXPORTED_CLASSES` list; `SEN_EXPORT_CLASS` in sources is
  scanned), and the ether one only bites in the non-default hub mode (kept as
  an optional patch if the hub fallback is ever needed).
  The node `include:` lines of `config/drone.yaml` and `ground_station.yaml` rely on
  `@env()` being expanded inside included files, which the pin `05da288e` does and newer SEN `main`
  no longer does: check that before a SEN bump.

## 10. Repository layout

```
README.md  ARCHITECTURE.md  sim_spec.md  AGENTS.md
CMakeLists.txt  docker-compose.yml
interfaces/        the drone_sim_interfaces package: the skeleton's bus contracts only (§8); VERSION (the contract version)
                   and cmake/drone_sim-config.cmake: installed as the partner SDK /opt/drone_sim (§4.4)
packages/
  README.md        what a partner copies, reads and ignores
  CMakeLists.txt   set(packages …) + foreach, SEN style
  nodes/           THE SKELETON
    drone_nodes/     on-board nodes, would run on a real vehicle (example_node, waypoint_navigator;
                     waypoint_navigator/test/waypoint_navigator_test.cpp)
    ground_station_nodes/  ground-station nodes (fleet_monitor)
    sim_nodes/       simulator-only stand-ins a real system would replace (imaging_sensor)
  ground_station/  ground station                      ← reference component
  airframe/        kinematic flight model + flight controller + truth and drone<ID> (DroneLink) publishers
                   test/flight_controller_test.cpp
  world/           clock, environment, ground assets                ← sim internal
                   test/world_test.cpp: one of the three TestKernel unit tests (the pattern; ctest --test-dir build)
  common/          geo.h (flat-earth helpers, SEN-free), sen_helpers.h (first(sub): one-line subscription read)
config/            world.yaml  drone.yaml  ground_station.yaml   (drone.yaml uses $DRONE_ID)
                   ether.yaml = the transport block every process includes (also /opt/drone_sim/config/ether.yaml)
                   drone.yaml is the one drone config
scripts/           up.sh  spawn_drone.sh  down.sh  run_native.sh  smoke.sh  scenario.py  check_names.py
                   run_devmachine.sh  check_health.py  check_health.sh (the SEN development container)
                   sim_time_check.py (measures the sim clock against a running stack, §4.1)
                   release.sh (drone_sim/sim:<VERSION> as a file in dist/, git-ignored)
                   watch_build.sh (rebuilds in the devmachine, run_devmachine.sh into build-docker/, on CMake/C++/STL
                   changes; needs inotify-tools)
docker/            Dockerfile.sen-base  Dockerfile  Dockerfile.web  Dockerfile.devmachine  drone.compose.yml (one drone)
external/          wp4000/, wp5000/ = the WP4000/WP5000 interface repositories (git-ignored, never committed, not
                   open source; built only natively if present, never in our image), targets wp4000, wp5000 (§4.3, §4.4); partner components, one folder each (§4.4): <name>/ = the .stl verbatim
                   (built only where our code reads it typed) + README (image tag, contract version);
                   <name>/source/ = the partner's source when delivered as source; `.dockerignore`: no external/ in our image
examples/          partner_geocage/: what a partner has at its site (source, Dockerfile); not in our build, its image built by scripts/up.sh under its profile
patches/           optional SEN patches (ether TCP-hub fallback only)
viz/               the UI: serve.py index.html swarm.css app/ sen_client.js vendor/ data/
                   fetch_area_assets.py test/ README.md
docs/              GLOSSARY.md (allowed short forms, acronyms); sen_map.html (task documents and
                   reviews are internal, in the private repository only)
scenarios/         one YAML per scenario (data only), run by scripts/scenario.py
```

A partner opening the repo sees contracts, packages and configs. Nothing of the UI
exists outside `viz/`, and all of `viz/` is `.dockerignore`d out of the service
image (a UI edit must not trigger a C++ rebuild; `web` has its own context).

## 11. Key design decisions (and why)

| Decision | Why |
|---|---|
| Kinematic flight, not rigid-body dynamics | Mission-level behaviour testing; it only has to look natural in the 3D view. |
| No radio component: nodes others call or read publish on `swarm.bus` themselves, nodes read other drones and the ground station there directly | The air link is an IP network below SEN (`ether` over a mesh radio or the Docker network) and link quality is not simulated, so a bridge would only copy data, one forwarder or mirror per message type. A cross-drone message is a method on the node's own `.stl`. `drone<ID>` stays as the vehicle's face because `flight_controller` stays off the shared bus. Cost: several `swarm.bus` interests per drone process (one query string per class, §8). |
| Spawn/kill drones via `scripts/spawn_drone.sh` or the UI (`serve.py` `/spawn`, `/kill`), both `docker compose -p drone<N>` on `docker/drone.compose.yml` | Identical compose projects make a new drone one command; the skeleton needs no UI for it. |
| Every object is a YAML object with its own subscriptions; none is created at runtime | A drone has exactly one link and one truth object, known from `DRONE_ID` before the kernel starts; a spawn is a compose project, not an object. Runtime creation is for a dynamic count (`terrain_server`, `school`). |
| Flight model lives in the drone's core container, not in the world | The airframe *is* the drone; N drones = N identical compose projects; the drone bus is real from day one; no per-drone bus plumbing in the world. |
| Drone bus = one SEN session per drone, `drone<ID>.bus`; a drone is a compose project of containers (not session `local`) | Partners deliver on-board components as Docker images only, and `local` never leaves its process, so it could not hold them. Isolation is by naming now, not by the middleware — accepted, security is out of scope. Our nodes stay in one process. |
| A partner component always runs in its own container, a service in the drone's compose project or in `docker-compose.yml`, profiles `partners` and its own name; partners build it from source at their site and most likely hand over only the image | Adding one is a compose block, a source delivery (the exception) is a `build:` line, replacing a stand-in is one commit: no rename or rework after hand-over. Partners may keep their source; a clean clone needs no partner image. Our own nodes stay in one process (a container each measured ~12 kernels per drone). |
| Three sessions, three buses, fixed names | Trivially explainable; every process's YAML is a handful of lines. |
| SEN defaults first: multicast discovery, canonical package pattern, upstream `main` | Every v3 patch traced back to a non-default mode, a non-canonical CMake call, or a stale checkout. Defaults are the tested path. |
| UI commands via swarm bus only | The UI is an operator, not a cheat channel; on-board behaviour is testable as-is. |
| Operators call the drone's objects directly, no ground-station forwarder | SEN object calling: find the object, call its method. A forwarder would add no policy, duplicate two contracts and cost three edits per new drone command. C2 policy, if ever needed, is a ground-station node that does something. |
| One compose file for the fixed services, one for a drone's compose project, one drone config template | v3 died of generated configs and scripts. Keep everything hand-readable. |
| Sim clock is soft-synchronised (time scale broadcast, no lockstep) | Prototype fidelity is enough; lockstep would couple every process. |
| … measured against SEN's virtual clock (2026-09-25): kept (decided 2026-10-06), SEN virtual time later | `runMode: virtualTime` in every process, the world as master, a REST driver: 3 drones held 1.0× at 50 Hz with less CPU (drone 18–21 % vs 52–69 %, world 23 % vs 4 %), one `steps(50)` = 143 ms wall (2.9 ms per 10 ms step), ceiling ~2.6× (today 100×), a mid-run drone stepped 1.7 s after launch. But at the pin a drone that stops while stepped freezes every process for good (the master waits on its clock without a timeout; SIGKILL does not release it), a joining kernel's `api.getTime()` starts at 0 instead of the master's time, `rest` cannot stay in a stepped world (it only answers when stepped and waits wall time every cycle; a real-time gateway changes the class names the UI dispatches on), clock names must be set per process, and SIGTERM does not stop a stepped process. Spawn/kill and container restarts are routine here, so lockstep costs more than it gives; reopen when upstream bounds that wait and syncs joiners. |
| RPR FOM dropped for good 2026-10-06: WP4000 no longer extends `rpr.Aircraft` | It made a circular dependency, and WP4000 should not hard-link a simulation standard (the WP4000 maintainers); ~26k lines, the heaviest codegen in the build, used by nothing of ours. For HLA, take it from SEN (`airbus/sen/examples/packages/hla_fom`), not from an old copy. |
| WP4000/WP5000 interfaces from the partners' repositories in git-ignored `external/wp4000`, `external/wp5000` (agreed with the WP4000 maintainers) | One source of truth, maintained by the partners; not open source, so never in this repository; the public build skips them. Never edit `external/`: fixes (the former `CHANGES.md` codegen edits are upstream now) go upstream via the WP4000 maintainers. |
| Each package owns its `.stl`; only bus contracts live in `interfaces/` | What SEN's own examples do. A new node is one directory, not an edit to a shared interfaces list. |
| What another drone, the ground station or another package calls or reads is a bus contract in `interfaces/` (`WaypointNavigator`) | Callers depend on contracts only, no node exports symbols for their sake, and no CMake workaround for the DEPS chain is needed. |
| `DroneLink` carries no partner type; `drone_sim_interfaces` stays partner-free | The ground station sees a drone without loading WP4000/WP5000 types. The status enums formerly mirrored on `DroneLink` (`common/status.stl`) are gone: the UI reads the nodes. |
| Peers are the subscription list, read where used; callbacks only for event guards and departed objects | SEN keeps the list current; pointer bookkeeping per peer was twenty-five copies of what `calculators` does in one line. |
| SEN's clock only: `api.getTime()` deltas, no OS clock in any object | Objects step under `TestKernel`, virtual time stays possible, and sim time and the flight model agree at every time scale. |
| One drone config, `config/drone.yaml` = the skeleton, no overlay | "Copy the template, add one `include:` line" stays true; partner components are compose services, not config overlays. |
| Vehicle state is one best-effort struct, not a dozen properties | No half-updated snapshots (one value committed in one cycle), one time-of-validity, and the derived fields partner telemetry wants are computed once. |
| Everything UI under `viz/` | The UI is not the deliverable; a partner reading the skeleton should never meet a shader. It also keeps ~6.6 MB out of the drone image. |
| three.js architect's-model view replaces Cesium | The swarm reads at a glance at theatre zoom (min-size rule, distance cues); 1 MB vendored instead of 23 MB; nothing fetched at runtime, no keys. |
