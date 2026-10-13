# Changing the drone-bus contract

`flight_controller.stl`, `sensor.stl` and `../swarm_bus/waypoint_navigator.stl` are what on-board software is written against. **They are
not frozen** (2026-09-22): the skeleton is still being shaped, and a freeze is a hand-off decision
taken with the partners, not something this repo declares on its own. Until then the rules are:

- **The `.stl` files are the reference of highest priority.** `sim_spec.md` and
  `ARCHITECTURE.md` describe them; where a document and a `.stl`
  disagree, the `.stl` is right and the document gets fixed.
- The shared value types they use live in `../common/types.stl` and follow the same rule.
- `sensor.stl` is published by `packages/nodes/sim_nodes/imaging_sensor` and consumed by nothing yet.

Why care about changes at all: a type change is not caught at runtime. SEN's compatibility
conversions make a mismatch between two processes **silently lossy** — an old node talking to a
new flight controller drops fields, it does not fail. So every process on every bus must be built from the same
`.stl`.

## Changing one

1. Change the `.stl` and the impl that publishes it together; say why in the commit. Adding a
   field to a struct or a method to a class, or changing a transport mode (`[confirmed]`), is a
   change like any other.
2. Rebuild **everything** (`scripts/up.sh`, or `cmake --build build` for the native
   stack) and restart **everything** — not only the process you changed.
3. Update the partner-interface notes in `sim_spec.md` §14 if the change touches a type that
   mirrors a partner type (`GeoPosition`, `Route`).
4. A comment edit costs nothing more. A type change costs one number in `interfaces/VERSION` and one
   line below; whoever runs a partner image built `FROM drone_sim/sim` before it (`external/`,
   `sim_spec.md` §18) rebuilds it then. Nothing checks this.
5. `interfaces/VERSION` is also the release version (`ARCHITECTURE.md` §4.4): a release is tagged
   `v<VERSION>` and gets a `CHANGELOG.md` entry with that number. A release without a contract change
   still bumps the last digit, with a line below, so the two never drift apart.

What this does not cover: a node's own `.stl` under `packages/nodes/<group>/<node>/stl/`. That
is the node author's, as long as nothing on the swarm bus depends on it.

## Version log

### 0.20.1: partner field lists out of the comments; frames, ids, file places

- Comments only in `common/types.stl`: `GeoPosition` and `Route` name the partner types, no longer their fields.
- Comments only: `Vec3` is NED unless the field names another frame; `VehicleState.bodyRates` is body axes
  (x forward, y right, z down). `FlightController.droneId` is a positive integer written as a string (type unchanged).
- `waypoint_navigator.stl` moved from `drone_bus/` to `swarm_bus/` (its object is on `swarm.bus`): an `#include`
  path change for anyone who compiles it; package and type names unchanged.
- Outside the contract: `packages/common/sen_helpers.h` keeps `first()` only; the empty partner placeholder folder under `interfaces/` is gone.

### 0.20.0: the vehicle contract says what it does

- Comments only in `flight_controller.stl`, `common/types.stl`, `sim_bus/world.stl`: no arbitration (the
  last command wins), the `takeoff` range, `goToPosition` speed `<= 0` = cruise and the altitude floor,
  holding by `goToPosition(state.position, 0)`, `arm`/`disarm` twice, `crashed` counts as armed,
  `setTimeScale` range, `simTime` still while paused.
- `[confirmed]` on `World.timeScale`, `World.paused`, `WaypointNavigator.status`.
- An unflyable envelope (`SimAirframe`) is refused at startup instead of clamped.

### 0.19.0: direct SEN calls, no ground-station forwarder

- `GroundStation` (`swarm_bus/ground_station.stl`) is `heartbeat` only: the eight forwarding methods (`arm`,
  `disarm`, `takeoff`, `land`, `goToPosition`, `setVelocity`, `setRoute`, `cancelRoute`, each with a leading
  `droneId`) and the `swarmBus` static are removed, with their `deferredMethods` entry in
  `interfaces/codegen_settings.json`. Operators call `swarm.bus/drone<ID>`
  (`DroneLink`) and `swarm.bus/waypoint_navigator_drone<ID>` (`setRoute`, `cancel`) directly; both unchanged.

### 0.18.0: the airspace is a static from YAML; the SDK holds no partner library

- `World.airspace` (`sim_bus/world.stl`) is `Airspace [static]`, written in `config/world.yaml` like `origin`
  (was `[confirmed]`, read from `scenarios/airspace_default.json`); `World.airspaceJson` removed, with the
  `AIRSPACE` env, `packages/common/airspace.h` and the vendored `nlohmann/json`.
- `/opt/drone_sim/lib` holds no `libwp4000`/`libwp5000` any more, and the image no `/app/external`: a partner
  component that needs the WP4000/WP5000 types builds them in its own image.

### 0.17.0: ground contact in flight is a crash; arrivalRadius is what is flown

- `FlightMode.crashed` (`types.stl`, `FlightController` comment): also entered when the vehicle touches the
  terrain in `hold` or `goingTo` (e.g. `setVelocity` with a sink rate); before, it slid along the ground.
- `AirframeEnvelope.arrivalRadius` comment: a vehicle may require a minimum. The simulator's airframe refuses
  to start below it instead of flying a larger radius than the published one. No type changed.
- `sensor.stl` header comment: "consumed by nothing yet" dropped. A comment only, so no version
  bump, but `contracts.sha256` (a hash of the `.stl` bytes) changes with it.

### 0.16.0: the partner interfaces move to `external/`

- No `.stl` of ours changed. The ERA2 partner interfaces come from the partners' own repositories in
  `external/wp4000`, `external/wp5000` (the WP4000 maintainers' external_forkout; targets `wp4000`, `wp5000`, built only
  when present, not in `contracts.sha256`).
- Removed from the SDK (`/opt/drone_sim`): the RPR FOM and the targets `aircraftera_interfaces`,
  `av_confinement_interfaces`, `acem_interfaces`, `aucc_interfaces`, `rpr_fom`.

### 0.15.0: the ERA2 stand-ins leave the release; the contracts are model-agnostic

No mission contract, no leader/follower:

- Removed `common/mission.stl` (`Mission`, `FormationSlot`, `MissionPhase`, `FormationIntent`,
  `FormationChange`).
- Removed from `GroundStation`: property `mission`, methods `uploadMission`, `clearMission`, `abortMission`
  (the ground station forwards the eight flight/route commands only).
- Removed `drone_sim.ManageMission` (`interfaces/era2`) and the `manage_mission_drone<ID>` objects on
  `swarm.bus`; the node-local `create_route.stl` went with its package. A one-drone mission is a route:
  `GroundStation.setRoute(droneId, route, speed)`, complete when `waypoint_navigator_drone<ID>` reports
  `arrived`.

No detect-and-avoid, no flight-dynamics stand-in:

- Removed `drone_sim.DetectAndAvoid` and `drone_sim.Intruder` (`interfaces/era2`, `detect_and_avoid.stl`) and
  the `detect_and_avoid` / `flight_dynamics` objects on the drone bus (`SimFlightDynamics` went with its package;
  `aircraftera.ModelFlightDynamics` stays in the partner SDK).
- Removed `WaypointNavigator.resume()` (its only caller was `flight_dynamics`). `WaypointNavigator` has
  `setRoute` and `cancel`.

No confinement chain:

- Removed `drone_sim.AirspaceMonitor` (`interfaces/era2`, `airspace_monitor.stl`, with its `compliance`
  property) and the `trajectory_predictor` / `airspace_monitor` / `acem` objects on the drone bus
  (`SimTrajectoryPredictor`, `SimAcem` went with their packages; `av_confinement.TrajectoryPredictor`,
  `av_confinement.AirspaceMonitor` and `acem_package.ACEM` stay in the partner SDK).
- With its last class gone, the package `drone_sim_era2_interfaces` (`interfaces/era2/`) is removed from the
  build and the SDK. `find_package(drone_sim)` offers `drone_sim_interfaces` and
  the partner packages.
- Unchanged: `GroundStation.heartbeat` (C2 liveness for a partner component on board) and `World.airspace`.

Model-agnostic: no vehicle model in the contracts:

- `AirframeEnvelope` is `{minSpeed, cruiseSpeed, maxSpeed, arrivalRadius}`: removed `maxBankDegrees`,
  `maxFlightPathDegrees`, `loiterRadius`; added `arrivalRadius` (m, within this horizontal distance a target
  counts as reached; `WaypointNavigator` and the flight controller's goingTo -> hold both use it). The three
  fixed-wing limits are `SimAirframe` statics now (`packages/airframe`, YAML `config/drone.yaml`).
- `FlightController` comment: generic semantics only; the fixed-wing realisation (launch run, loiter circle,
  `setVelocity` rejecting zero ground speed) is documented on `SimAirframe` (`airframe.stl`).
  `WaypointNavigator`, `NavigatorStatus.arrived`, `VehicleState` heading/course: no loiter, no wind.
- Removed `FlightController.heartbeat`. `DroneLink.heartbeat` stays (fleet liveness) and is counted by the
  link itself (10 Hz while a flight controller is behind it, also while paused); `GroundStation.heartbeat` stays.
- Removed `World.wind` (always zero, read by nobody).

No simulator, UI or stand-in reasons in the contracts:

- `AckStatus::rejectedLinkLost` renamed `rejectedUnavailable` ("the target is not there"; same ordinal 3): there
  is no radio link. Used by `ground_station` (no `drone<ID>` / navigator) and `drone<ID>` (no
  `flight_controller`).
- `NoFlyZone` / `NoFlyZoneList` moved from `common/types.stl` to `sim_bus/world.stl`, next to `Airspace`, their
  only user (same package `drone_sim`, same C++ names; `#include` `world.stl.h` for them).
- `common/types.stl` conventions: the flat-earth / "one mission origin per scenario" line removed; it is a property
  of the simulated world (`World`, `SimAirframe` comments). WGS84, m AMSL, NED stay.
- Comments only: `FlightController.homePosition` and `Sensor` explained without the sim bus (the simulator
  reasons are on `SimAirframe` / `SimSensor`); no contract names the UI (`WaypointNavigator`, `DroneLink`,
  `GroundStation`). `World` says it is a simulator-only object and `World.airspace` display-only (kept).
