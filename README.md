# drone_sim: a SEN-based drone swarm simulator

drone_sim is a **skeleton for drone swarm software** built on
[SEN](https://github.com/airbus/sen), the Airbus middleware. It gives you the bus contracts, the
package layout and the configs. Partners build and test their own SEN components on top of it.
The simulator is there to exercise the skeleton: it lets a component run in a realistic
multi-drone setup before it goes onto a real vehicle.

## Goal

Code written against the skeleton should run **unchanged** on the vehicle. To make that possible,
the simulator copies the real topology:

- **Topologically honest**: each drone is its own Docker Compose project, with its own bus.
- **Runnable anywhere**: clone the repository, run `scripts/up.sh`, open a browser. No manual setup.
- **Simple**: the smallest thing that shows the architecture. The flight model is kinematic.
- **Legible**: only standard SEN patterns are used, and the folder layout shows where a new node goes.

## How it fits together

```
 world ──────────── sim.bus ──────────── browser UI (god's-eye view)
   │
 swarm.bus ── ground_station, UI, drone1, drone2, …
                                  │
                           drone<ID>.bus ── flight_controller, sensor, on-board nodes
```

- **`drone<ID>.bus`**: one per drone, private to that drone's containers.
- **`swarm.bus`**: shared by the drones, the ground station and the UI.
- **`sim.bus`**: the world's ground truth (terrain, clock, positions). Only the UI and simulator code read it.

Details are in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Quick start (Docker)

Add a `wp4000` and a `wp5000` archive under `external/`: the build needs them. For details, see
[`BUILDING.md`](BUILDING.md#wp4000wp5000-partner-interfaces).

You need Docker with BuildKit/buildx, which is standard in Docker Desktop and docker-ce.

```bash
git clone <this repository> && cd drone_sim_v4
scripts/up.sh 2        # build what is missing, then start the world, ground station, web UI and 2 drones
scripts/smoke.sh 2     # check: arm, take off, fly a route, land
scripts/down.sh        # stop everything
```

Then open **http://localhost:8000**.

> **The first run is slow.** It builds the SEN base image and the simulator image, which takes
> about 1.5 h on one core. Later runs only rebuild what changed. The build uses 16 compile jobs by
> default. **On WSL2, use `JOBS=1 scripts/up.sh 2`**, because more jobs run the VM out of memory.

### Ports

| Port | Service | Move it with |
|---|---|---|
| 8000 | browser UI (`web`) | `WEB_PORT=8001` |
| 8080 | SEN REST API (`world`) | `REST_PORT=8090`, then `SEN_REST=http://localhost:8090 scripts/smoke.sh` |

Both ports are published on 127.0.0.1 only.

### More drones

```bash
scripts/spawn_drone.sh 3                  # drone3, parked 300 m east of the origin
scripts/spawn_drone.sh 4 59.914 10.752    # drone4 at a given position
DRONE_ID=3 docker compose -p drone3 -f docker/drone.compose.yml --profile '*' down   # remove drone3
```

You can also spawn and remove drones from the browser: click **Spawn**, then click on the map.
**Remove** takes down the selected drone.

### Scenarios

Each scenario (`scenarios/<name>.yaml`) restarts the stack, sends its steps and checks the end
state. It needs `python3-yaml`.

```bash
scripts/scenario.py battery_crash   # prints PASS/FAIL per expected value
scripts/smoke.sh 2 initial          # generic checks plus that scenario's end state
```

### Partner components

Partner components are optional compose services, switched on with a profile:

```bash
COMPOSE_PROFILES=geocage scripts/up.sh 2   # adds the example geocage partner component
```

Run `scripts/down.sh` before starting again with different profiles.

### Something wrong?

Run `scripts/check_health.sh [EXPECTED_DRONES]`, then see
[`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

## The browser UI

In the UI, pick a drone in the fleet list or on the map. The command dock at the bottom sends
arm, takeoff and land. **Add WP** adds waypoints (click the map; double-click sends the route).
The map shows ground truth from `sim.bus`. Every command is a call on the drone's own objects on
`swarm.bus`. More: [`viz/README.md`](viz/README.md).

## Documentation

| Read this | For |
|---|---|
| [`BUILDING.md`](BUILDING.md) | Native builds, the SEN development container, build times |
| [`docs/PARTNERS.md`](docs/PARTNERS.md) | Adding a node or a partner component, the partner SDK, the release file |
| [`packages/README.md`](packages/README.md) | The SEN skeleton: what to read, copy and ignore |
| [`packages/nodes/README.md`](packages/nodes/README.md) | Writing a node, and the SEN hazards at the pinned commit |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System design |
| [`sim_spec.md`](sim_spec.md) | Design decisions |
| [`docs/GLOSSARY.md`](docs/GLOSSARY.md) | Names and acronyms |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | Platforms and Docker startup problems |
| [`AGENTS.md`](AGENTS.md) | Orientation for coding agents |
| [`CHANGELOG.md`](CHANGELOG.md) | What each release contains |

## License

Mozilla Public License 2.0, see [`LICENSE`](LICENSE).
