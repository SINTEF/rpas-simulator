# packages/ — what to read, copy and ignore

| Directory | What it is |
|---|---|
| `nodes/` | **The skeleton.** Copy `nodes/drone_nodes/example_node/` to start your own; `nodes/README.md` is the how-to. Examples: `waypoint_navigator` (on-board), `fleet_monitor` (ground station), `imaging_sensor` (simulated payload). |
| `ground_station/` | Read it: the smallest possible SEN package — one `Impl` of a contract class from `interfaces/` (no `.stl` of its own); its YAML block is `config/ground_station.yaml`. |
| `airframe/`, `world/` | Simulator internals. Ignore them, except `airframe/src/drone_link_impl.cpp`: `swarm.bus/drone<ID>`, the vehicle's public face, shows deferred command forwarding and a per-drone swarm-bus object declared in YAML (`drone@env(DRONE_ID)`). |
| `common/` | Header-only helpers: flat earth (`geo.h`), subscription reads (`sen_helpers.h`: `first`). No SEN objects in it. |

Bus contracts are in `interfaces/` (package `drone_sim_interfaces`); a package's own
interface lives in that package's `stl/drone_sim/…` folder and reaches the shared
types via `DEPS drone_sim_interfaces`. Add a package: one directory, one line in
`packages/CMakeLists.txt`, one block in a `config/*.yaml`.

The drone bus is `drone@env(DRONE_ID).bus` (SEN session `drone<ID>`, one per drone), joined by
every container of that drone's compose project. `example_node` runs in both placements: in our core
process (`config.yaml`) and as an on-board partner container built against the partner SDK (`Dockerfile`,
`drone.yaml`, profile `example_node`; `../README.md` "Adding a component"). A base-station + on-board pair
delivered as a Docker image: `../examples/partner_geocage/README.md`.
