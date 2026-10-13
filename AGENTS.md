This is a SEN middleware project (Airbus SEN, github.com/airbus/sen). Docker builds default to `JOBS=16` (`docker/Dockerfile`, `docker/Dockerfile.sen-base`, `scripts/up.sh`); on a WSL2 VM use `JOBS=1` (native builds at most `-j2`): parallel builds run it out of memory and crash it.

Prefer simple, KISS designs over over-engineered solutions, and be token efficient with short responses.

## What this is

A SEN-based drone swarm simulator. The deliverable is the SEN skeleton (bus contracts, packages,
configs) on which partners build and test their SEN components; the simulator exists to exercise it.
The browser UI under `viz/` is not the skeleton. Overview: `README.md`; design: `ARCHITECTURE.md`;
decisions: `sim_spec.md`; names: `docs/GLOSSARY.md`.

## Where things are

- `interfaces/`: the bus contracts (`.stl`); how to change them: `interfaces/stl/drone_sim/drone_bus/CHANGING.md`
- `packages/`: `README.md` says what to read, copy and ignore; `packages/nodes/README.md` is the node how-to
- `config/`: one YAML per process (`world`, `ground_station`, `drone`, `ether`)
- `docker/`, `docker-compose.yml`: images and compose files (`ARCHITECTURE.md` §9)
- `scripts/`: `up.sh`, `smoke.sh`, `run_native.sh`, `check_names.py`
- `examples/partner_geocage/`: a partner component delivered as a Docker image

## Buses (`ARCHITECTURE.md` §3)

- `drone<ID>.bus`: one per drone, its own containers only (`flight_controller`, `sensor`, on-board nodes).
- `swarm.bus`: drones, ground station, UI; an object goes here only if another drone or the ground station calls or reads it.
- `sim.bus`: the world's god's-eye view for the UI; on a drone only simulator code (the airframe, `packages/nodes/sim_nodes/`) reads it.

## SEN hazards at the pinned commit (`packages/nodes/README.md`, `ARCHITECTURE.md` §9)

1. One query per class per process; pick objects by `droneId` in code.
2. Lock order: drone bus first; an object on `swarm.bus` opens its drone bus in its first `update()`, never in `registered()`.
3. Over REST, only argument shapes that match the `.stl` (a `Vec3` is `[x, y, z]`); a wrong shape kills the process.

## Build, run, test (`README.md`, `BUILDING.md`)

- Native: `cmake -S . -B build -Dsen_DIR=$SEN_INSTALL/cmake/sen && cmake --build build -j2`, then `scripts/run_native.sh 2`
- Docker: `scripts/up.sh` (`JOBS=1` on a WSL2 VM)
- Check: `scripts/smoke.sh`, `ctest --test-dir build`, `scripts/check_names.py`

## Rules

- The skeleton looks like `airbus/sen/examples`: package layout (`stl/`, `src/`, `CMakeLists.txt`, `config.yaml`), `registered()`/`update()`, member subscriptions, `api.getTime()` as the only clock, `SEN_EXPORT_CLASS`; no wrappers over SEN.
- Whole-word names (`docs/GLOSSARY.md`, checked by `scripts/check_names.py`).
- Design changes go into `ARCHITECTURE.md` first; one hand-written config per process, no generators.
- Adding a node: copy `packages/nodes/drone_nodes/example_node/` and follow the four steps in `packages/nodes/README.md`.
- Do not touch `external/` (closed partner files, never committed), `viz/vendor/` (vendored verbatim) or the SEN pin (`docker/Dockerfile.sen-base`). No API keys, no accounts, nothing fetched at runtime.
