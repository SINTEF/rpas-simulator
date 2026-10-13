# Writing a node

A node is one SEN package: its `.stl` interface (its own, or a contract in `interfaces/` it
implements), one `Impl` class, a `CMakeLists.txt` and a `config.yaml` (its YAML block, included
by the process config). Three folders, by
where the code would run for real:

| Folder | Runs on | Sees | Shipped examples |
|---|---|---|---|
| `drone_nodes/` | the vehicle | `drone<ID>.bus`, and `swarm.bus` (the air link) | `example_node` (the template), `waypoint_navigator` (both on `swarm.bus`) |
| `ground_station_nodes/` | the ground station | `swarm.bus` | `fleet_monitor` |
| `sim_nodes/` | the simulator only | `drone<ID>.bus` + read `sim.bus` | `imaging_sensor` (see `sim_nodes/README.md`) |

`example_node` and `waypoint_navigator` demonstrate SEN component structure and communication
patterns. Their application behavior is illustrative, not the final project's autonomous
architecture. Partners implement navigation, detect-and-avoid, surveillance, and coordination
in their own nodes using the shared contracts (`ARCHITECTURE.md` §4.3).

**Partner quick start: three SEN hazards at the pinned commit** (`05da288e`; the why is in
`ARCHITECTURE.md` §8–9, the reports in `patches/sen/`). Break one and the process freezes, deadlocks or dies:

1. **One query per class per process.** Two different interests matching the same remote object
   freeze it for that process. Safe: one `selectAllFrom<drone_sim::FlightControllerInterface>(droneBus)`
   member, shared by every component of the process, and pick by `droneId` in code; never a `WHERE` or a
   `SELECT *` next to it (Pitfalls below).
2. **Lock order: drone bus first.** `registered()` holds your object's bus lock. An object on
   `drone<ID>.bus` may open `swarm.bus` there; an object on `swarm.bus` opens its drone bus in its first
   `update()` (`example_node_impl.cpp`), never in `registered()`.
3. **Over REST, only argument shapes that match the `.stl`.** A wrong shape (a JSON object for a
   `Vec3`, which is an array `[x, y, z]`) aborts the world process: restart the stack. Copy the shapes from
   `scripts/smoke.sh` or `viz/test/commands.test.js`.

When testing your own flight-control node, remove the `waypoint_navigator/config.yaml` include
from `config/drone.yaml`, rebuild the Docker image if using Docker, and restart the drone.
This disables the demonstration follower so it
does not issue competing flight commands.

## Naming

Names are whole words (`ARCHITECTURE.md` §8): `position`, `message`, `command`, not `pos`,
`msg`, `cmd` — in your `.stl`, your YAML (object and component names, keys) and your C++
(members, locals, helpers; a one-line lambda may keep `r`). SI units are the default and go in the
comment; the name says the quantity (`lookaheadTime`, `range`), and only a non-SI unit is in the
name, spelled out (`fieldOfViewDegrees`). Object names are the role in `snake_case`
(`waypoint_navigator`). The few allowed short forms and every partner acronym are in
`docs/GLOSSARY.md`; `scripts/check_names.py` (run by `scripts/smoke.sh`) fails on the others.

## Add a node in four steps

`example_node` is the whole pattern and nothing more: its object `swarm.bus/example_drone<ID>`
subscribes to `flight_controller` on its drone bus, publishes `position` from it, and takes one call
over the air, `setMessage(message) -> CommandAck`, publishing the last `message`.

1. **Copy** `drone_nodes/example_node/` to `drone_nodes/<my_node>/` and rename everything that
   says `example_node` / `ExampleNode` / `example`: the directory, `TARGET` in `CMakeLists.txt`,
   the `.stl` file and its class, the `src/` file names, the impl class, the C++ `namespace`
   (**it must equal `TARGET`**, or `sen run` dies with `undefined symbol: …senExport…`), and the
   component and object names in `config.yaml`.
2. **Edit the `.stl`**: your properties, methods and events. Shared contract types (`GeoPosition`,
   `CommandAck`, `Route`, …) come from `import "stl/drone_sim/common/types.stl"`; the flight controller's from
   `stl/drone_sim/drone_bus/flight_controller.stl` (`state` is a `VehicleState`: `position`, `velocity`, `attitude`,
   `bodyRates`, `heading`, `course`, `groundSpeed`, `verticalSpeed`, `mode`, `battery` (`f64`, 0..1), `stateTime`); `DEPS drone_sim_interfaces` brings them all. The
   template's `package drone_sim;` (folder `stl/drone_sim/nodes/`) is for nodes shipped with the
   simulator; a partner's copy uses its own `package <yours>;` and folder `stl/<yours>/`. Then fill in
   `registered()`, `update()` and your method impls.
3. **One line** in `packages/CMakeLists.txt`, in the `set(packages …)` list, *after* every
   package your `DEPS` names (their properties are copied at configure time).
4. **One `include:` line** in `config/drone.yaml` (or `ground_station.yaml`) naming your
   `config.yaml`, which holds the block: `group: 4` or higher so it starts after `flight_controller`
   (discovery is asynchronous: handle an empty list), `bus: drone@env(DRONE_ID).bus` (or `bus: swarm.bus`
   with `name: <name>_drone@env(DRONE_ID)` if other drones or the ground station call or read it, below),
   and never a `sim.*` bus. The component `name:` must be unique in the process (`sen run` refuses a
   repeated one) and so must the object `name:` on the bus. Removing the node again is deleting that line.

Then `cmake -S . -B build …` (re-run the **configure** step, not only the build: the
`SEN_EXPORT_CLASS` line is found by scanning sources at configure time) and `cmake --build build`.
Check `nm -D build/lib/lib<my_node>.so | grep -c senGetType` prints 1.

The copy and rename of step 1, for a node `my_node` (class `MyNode`):

```bash
cd packages/nodes/drone_nodes && cp -r example_node my_node && cd my_node
mv stl/drone_sim/nodes/example_node.stl stl/drone_sim/nodes/my_node.stl
mv src/example_node_impl.h src/my_node_impl.h && mv src/example_node_impl.cpp src/my_node_impl.cpp
find . -type f -exec sed -i 's/example_node/my_node/g; s/ExampleNode/MyNode/g; s/exampleNode/myNode/g; s/example_drone/my_node_drone/g; s/example_sidecar/my_node_sidecar/g' {} +
```

**The same folder as a partner container** (`ARCHITECTURE.md` §4.4): `CMakeLists.txt` also builds
stand-alone against the partner SDK (`find_package(drone_sim REQUIRED)`, only when the folder is the
top level), `Dockerfile` builds it `FROM drone_sim/sim` and `drone.yaml` runs it there as a
second object, `swarm.bus/example_sidecar_drone<ID>` (object and component names must differ from the
core's). The compose service is `example_sidecar` in `docker/drone.compose.yml`:
`COMPOSE_PROFILES=example_node scripts/up.sh 2` builds and starts it in every drone. A node that stays
in our core process needs neither file.

What codegen makes of your `.stl` (header `build/…/stl/drone_sim/nodes/my_node.stl.h`, included as
`"stl/drone_sim/nodes/my_node.stl.h"`):

| `.stl` | C++ |
|---|---|
| `class MyNode` | `MyNodeBase` (your impl derives from it), `MyNodeInterface` (what a peer's subscription holds) |
| `var x : T;` | `getX()` (committed value), `setNextX(v)` (staged for the next commit) |
| `var x : T [static];` | `getX()`, set from the YAML key `x` |
| `fn x(a : f64) -> CommandAck;` | you implement `CommandAck xImpl(f64 a) override`; a caller writes `peer->x(a, {this, cb})` |
| the same, deferred (`interfaces/codegen_settings.json`) | `void xImpl(f64 a, std::promise<CommandAck>&& promise) override` (`../airframe/src/drone_link_impl.cpp`) |
| `event x(a : u32);` | emit `x(a)`; a listener writes `peer->onX({this, cb})` |
| `f32` `f64` `u32` `u64` `bool` `string` / `sequence<T>` (a named type) | the same names (`f64` …, SEN typedefs), `bool`, `std::string` / a class with the `std::vector` interface |

Warnings are errors (`-Werror`, `-Wdouble-promotion` included): `static_cast` when you mix `f32` and `f64`.

To look at your object while it runs, ask the world's REST (`http://localhost:8080`) for
`SELECT * FROM swarm.bus` (or `drone1.bus` for a drone-bus object: the drone bus is SEN session
`drone<ID>`, joined by every container of that drone's compose project). Calling a method from the
shell is auth → interest → invoke → poll (`scripts/smoke.sh` does the same):

```bash
R=http://localhost:8080; C="curl -s -b /tmp/jar -c /tmp/jar -H Content-Type:application/json"
$C -d '{"id": "me"}' $R/api/auth
$C -d '{"name": "swarm", "query": "SELECT * FROM swarm.bus"}' $R/api/interests
$C -d '["hello"]' $R/api/interests/swarm/objects/example_drone1/methods/setMessage/invoke   # -> {"id": N, "status": "pending"}
$C $R/api/interests/swarm/objects/example_drone1/methods/setMessage/invoke/N   # {"status": "finished", "result": "<CommandAck as a JSON string>"}
$C $R/api/interests/swarm/objects/example_drone1/properties/message
```

In the result, `status` is the `AckStatus` index (`common/types.stl`): 0 accepted, 1 rejectedInvalid,
2 rejectedState, 3 rejectedUnavailable; the `message` says why.

**Testing your node:** in our tree, `drone_nodes/waypoint_navigator/test/waypoint_navigator_test.cpp` is the pattern
to copy: the node and the real `FlightControllerImpl` on one `sen::kernel::TestKernel` bus, virtual
time, a method call with its ack, property and event checks; its `CMakeLists.txt` adds `TEST_TARGET`
and the `add_test`. Run it with `ctest --test-dir build`. Stand-alone against the partner SDK that test
does not link (it uses our internal test libraries): test against the running stack (REST, as above), or
write a small fake `FlightControllerBase` subclass for a `TestKernel` test.

## What a drone node may touch

- **Its drone bus** (`drone@env(DRONE_ID).bus`: `drone5.bus` on drone 5; the C++ reads the `droneBus` static, never a literal — `ARCHITECTURE.md` §3.1). The flight controller (`drone_sim.FlightController`, object `flight_controller`,
  contract in `interfaces/stl/drone_sim/drone_bus/flight_controller.stl`) is how it flies; `flight_controller.state` is one
  snapshot (one struct, committed in one cycle), `flight_controller.envelope` what the airframe can do, `flight_controller.homePosition` the AGL datum.
- Other nodes on the drone bus, by typed interest: `xSub_ = api.selectAllFrom<drone_sim::XInterface>(droneBus)`,
  kept as a member — in `registered()` if your object is on the drone bus, in the first `update()` if
  it is on `swarm.bus` (`example_node`; the lock-order pitfall below). `xSub_->list.getObjects()` is
  the current set of matching objects, read where the peer is used. Tolerate a peer being absent (an
  empty list).
- **`swarm.bus`, the air link** (a `swarmBus` static): other drones and the ground station, read and
  called directly — there is no radio component. Every drone's `drone<ID>` (`DroneLink`: telemetry,
  the six flight-controller commands), `waypoint_navigator_drone<ID>`, `example_drone<ID>`, and
  `ground_station` (`heartbeat`). One query per class covers all drones; pick one by
  `droneId` in code: `for (auto* o : xSub_->list.getObjects()) if (o->getDroneId() == id) …`, your own id from `flight_controller.droneId`. Drone ids are decimal integers as
  strings (`"3"`). Never a `WHERE` and never a name built in C++.
- Nothing on `sim.bus` (simulated sensors excepted, `sim_nodes/README.md`).

**Time and freshness.** `state.stateTime` and every peer's `telemetry.stateTime` are simulation
seconds, the same clock on every drone: it stops while paused and runs ×`timeScale`. Use it for
prediction; a peer's telemetry age is your own `state.stateTime` − its `telemetry.stateTime` (no
`sim.bus` needed). A stamp is the time of the position it comes with (to one 20 ms step ×
`timeScale`); state is published at 10 Hz of wall time, so consecutive stamps are 0.1 s ×
`timeScale` apart (10 s at 100×); on a loaded machine one may step back by a few milliseconds ×
`timeScale`. If a drone's `flight_controller` process stalls longer than 1 s (`docker pause`, a
loaded machine), that drone stands still for the rest of the gap; the clock does not wait. A stalled
node does not stop its drone. Your node's `update()` and `api.getTime()` run on wall time, so test
control loops at time scale 1. Liveness is a heartbeat (`DroneLink.heartbeat`,
`GroundStation.heartbeat`, wall clock, still running while paused), not presence: a paused process
stays present (`ARCHITECTURE.md` §6).

## Getting data and commands off-board

**Placement rule** (`ARCHITECTURE.md` §3): your node's object lives on `swarm.bus` if another drone or
the ground station calls or reads it; otherwise on the drone bus. On `swarm.bus` it is one per drone,
so in the YAML:

```yaml
      - name: my_node_drone@env(DRONE_ID)     # waypoint_navigator_drone3 on drone 3
        class: my_node.MyNodeImpl
        bus: swarm.bus
        droneId: "@env(DRONE_ID)"            # a `droneId : string [static]` in your .stl
        droneBus: drone@env(DRONE_ID).bus    # still flies / reads its siblings there
```

That is all it takes to expose a method or a property over the air: the method on your class is
called by the peer on your object (`example_drone<ID>.setMessage`, `waypoint_navigator_drone<ID>.setRoute`). If one of our nodes in another package or process calls
it typed, move its class to `interfaces/` (`interfaces/stl/drone_sim/<bus>/<my_node>.stl`, `<bus>` where the object lives) and list it in that `CMakeLists.txt`; the node
keeps no `STL_FILES` and implements the contract (`waypoint_navigator` implements
`WaypointNavigator`), so callers depend on contract packages only (`ARCHITECTURE.md` §8). A partner keeps its own interface package instead (`geocage_interfaces` in
`examples/partner_geocage/`). Changing a
contract `.stl` changes it for every process: rebuild and restart **every** process (see
`interfaces/stl/drone_sim/drone_bus/CHANGING.md`).

## Choosing the SEN construct

| Need | Use | Shown in |
|---|---|---|
| publish a value | `var x : T;` + `setNextX()` in `update()` | every node |
| a value another node sets, no answer needed | `var x : T [writable];` — the peer calls `peer->setNextX(v)` on the `XInterface*` it got from `selectAllFrom`, no ack | none shipped (the template stays small) |
| a command that must be validated or answered, or that crosses a bus | `fn x(...) -> CommandAck;` + `xImpl()` | `example_drone<ID>.setMessage`, `waypoint_navigator.setRoute` |
| tell listeners something happened, once | `event x(args);` — emit by calling `x(args)`; receive with `peer->onX({this, cb})` and keep the returned `ConnectionGuard` as a member | emitted: `waypoint_navigator.arrived`; received: `waypoint_navigator/test/waypoint_navigator_test.cpp` |
| several values that belong together | one `struct`, one property (committed in one cycle, so never half-updated; best-effort if it changes every cycle) | `flight_controller.state` |
| a YAML knob | `var x : T [static];` — the key in the object's YAML block | `waypoint_navigator.droneBus`, `waypoint_navigator.droneId`, `fleet_status.lostAfter`, `sensor.range` |
| a contract class plus simulator-only knobs | `class SimX : extends X { … [static] }` in the implementing package; impl base `SimXBase<XBase>` | `sim_nodes/imaging_sensor/stl/drone_sim/sim/imaging_sensor.stl` (`SimSensor : extends Sensor`), `airframe/stl/drone_sim/sim/airframe.stl` |

`[confirmed]` (reliable, ordered) is **mandatory** for an unbounded `string` or `sequence<>`
property — codegen refuses it otherwise ("may cause data loss"); it is the right choice for
anything published once or on change only. A value republished every cycle, a struct like
`flight_controller.state` included, stays best-effort: a lost update is replaced by the next one, and
best-effort never lets old data overwrite newer (SEN's documented choice for high-rate data).

## Pitfalls that bite node authors

- **Double buffering.** `getX()` is the committed value, `setNextX()` stages for the next commit;
  your own write is invisible to `getX()` until the next cycle. A default for a non-static property is a `setNextX()` in `registered()`; `setNext*` is allowed from
  `registered()`, `update()` and method impls (they run in the drain, before the commit), never
  from the constructor. Stage in the method, no `changed_` flag for `update()` to pick up.
  Read `get*()`. `getNext*()` is for a value you staged yourself in the same call (`my_counter`);
  a peer's write is visible through `get*()` next cycle.
- **Subscriptions and `ObjectSource` handles are members.** A local one dies with its scope and
  the list silently stays empty. The list is the peer: do not copy it into a pointer member kept
  current by added/removed callbacks — SEN already does that. Callbacks are for real work only:
  attaching an event guard when the peer appears, or remembering an object after it has gone
  (`fleet_monitor`).
- **Async calls.** `flight_controller->goToPosition(…, {this, cb})` returns immediately; the ack arrives one or two
  cycles later in `cb`. Never read a result in the same cycle. An `accepted` ack can mean
  "queued until airborne" — judge progress by state, not by the ack (`waypoint_navigator`). Every
  command gets a callback; a call without one drops its ack.
- **Groups order start-up.** Lower groups start first; put your node above `airframe` (2). Still
  handle the peer appearing later (an empty list until it does).
- **One object = one YAML block**, even when its name depends on the drone:
  `name: waypoint_navigator_drone@env(DRONE_ID)` works. Create objects at runtime only for a dynamic count (SEN's
  `terrain_server` per query, `school` per student); the skeleton has none.
- **Namespace = `TARGET`.** Otherwise the exports table does not link at load time.
- **Configure-time scan.** `SEN_EXPORT_CLASS` is collected when CMake configures; an unbalanced
  `[` or `]` anywhere in a source line — even in a comment — silently drops it. After adding an
  impl or renaming, re-run configure and check `nm -D lib*.so | grep senGetType`.
- **Unbounded `string` needs `[confirmed]`** even with `[writable]`.
- **Never match one remote object with two interests in one process.** A workaround for the
  kernel bug at SEN `05da288e` (`ARCHITECTURE.md` §9 has the full description); remove when
  upstream fixes it. On `swarm.bus` and `sim.bus` that freezes the object; the safe shapes are
  one `SELECT *` per bus, or typed interests with disjoint object sets (`imaging_sensor`'s
  `GroundAsset` next to the airframe's `World`). On the drone bus, which holds remote objects as
  soon as a partner container is in the compose project, our nodes use one typed query per class,
  the same in every component (`selectAllFrom<drone_sim::FlightControllerInterface>(droneBus)`), and never a
  `SELECT *` beside them. On `swarm.bus` the drone process holds no interest today; a drone node that
  reads it keeps one typed query per class, shared by every component of the process, and picks by
  `droneId` in code: never a `WHERE` next to a plain class query. A partner image follows the same rule: `../../examples/partner_geocage/`.
- **Lock order: drone bus, then shared bus.** SEN runs `registered()` holding the object's bus
  lock. A node object on `drone<ID>.bus` may open `swarm.bus` in `registered()`; an object published
  on `swarm.bus` or `sim.bus` (`example_drone<ID>`, `waypoint_navigator_drone<ID>`) opens
  `drone<ID>.bus` in its first `update()` and tolerates a method call before that (`first()` returns
  nullptr, the loop finds nothing). The reverse deadlocks the drone process (`ARCHITECTURE.md` §8/§9,
  `patches/sen/upstream-kernel-registered-cross-session-deadlock.md`).
- **Contract changes are silent across processes.** Rebuild and restart everything.

## Where each SEN pattern is demonstrated

| Pattern | File |
|---|---|
| Typed subscription to a peer, read from its list | `drone_nodes/example_node/src/example_node_impl.cpp` (`flightControllerSub_->list.getObjects()`), `first()` in `../common/sen_helpers.h` |
| A method called over `swarm.bus` | `example_node_impl.cpp` (`setMessageImpl`); the call from outside: `scripts/smoke.sh` (`example_drone1 setMessage`) |
| Publishing in `update()` | every `*_impl.cpp` |
| Node-owned `.stl` + shared types via `DEPS` | `drone_nodes/example_node/CMakeLists.txt`, `stl/drone_sim/nodes/example_node.stl` |
| Method returning `CommandAck` with validation | `drone_nodes/waypoint_navigator/src/waypoint_navigator_impl.cpp` (`setRouteImpl`) |
| Async call to the flight controller with an ack callback | `waypoint_navigator_impl.cpp` (`commandWaypoint`) |
| Deferred forwarding (the ack comes from another object) | `../airframe/src/drone_link_impl.cpp` (`armImpl` …), `interfaces/codegen_settings.json` |
| A node on `swarm.bus`, one per drone, picked by `droneId` | `drone_nodes/waypoint_navigator/config.yaml`, the `droneId` loop under "`swarm.bus`, the air link" above |
| Emitting and receiving an event | `waypoint_navigator_impl.cpp` (`arrived(…)`), `waypoint_navigator/test/waypoint_navigator_test.cpp` (`onArrived`) |
| Testing a node (TestKernel + gtest, the real flight controller) | `drone_nodes/waypoint_navigator/test/waypoint_navigator_test.cpp`, its `CMakeLists.txt` (`TEST_TARGET`, `add_test`) |
| A sim node reading `sim.bus` through a disjoint typed interest | `sim_nodes/imaging_sensor/src/imaging_sensor_impl.cpp` (`selectAllFrom<GroundAssetInterface>`) |
| Implementing a contract class, sim knobs via `extends` | `sim_nodes/imaging_sensor/stl/drone_sim/sim/imaging_sensor.stl`, `imaging_sensor_impl.h` (`SimSensorBase<SensorBase>`) |
| `[static]` from YAML, struct static | `fleet_monitor.stl` (`lostAfter`), `config/world.yaml` (`origin`), `config/drone.yaml` (`envelope`) |
| `[confirmed]` struct / sequence | `flight_controller.stl` (`homePosition`), `fleet_monitor.stl` (`drones`) |
| A runtime value that cannot be a `[static]` | `flight_controller.stl` (`homePosition`, published once, `[confirmed]`) |
| Iterating every object of a subscription | `sim_nodes/imaging_sensor/src/imaging_sensor_impl.cpp` (`assetSub_->list.getObjects()`) |
| Added/removed callbacks that remember departed objects | `ground_station_nodes/fleet_monitor/src/fleet_monitor_impl.cpp` |
| Creating objects at runtime (dynamic count only; the skeleton has none) | `airbus/sen/examples/packages/terrain_server` |
| One YAML object subscribing to what it forwards to (`fibonacci.Manager`) | `../airframe/src/drone_link_impl.cpp` (`DroneLinkImpl`), `config/drone.yaml` (`drone@env(DRONE_ID)`) |
| Extending a contract class | `../airframe/stl/drone_sim/sim/airframe.stl` (`SimAirframe : extends FlightController`) |
| `@env()` in YAML | `config/drone.yaml` (`DRONE_ID`, `START_LATITUDE`) |
