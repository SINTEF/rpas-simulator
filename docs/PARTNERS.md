# Adding a component

Read the partner quick start at the top of [`packages/nodes/README.md`](../packages/nodes/README.md)
first. It lists three SEN hazards at the pinned commit, each with a safe example.

## One template, three ways to run it

The template is `packages/nodes/drone_nodes/example_node/`.

### 1. Our node, in the core process

Copy the folder. Add one line to `packages/CMakeLists.txt` and one `include:` of its
`config.yaml` in `config/drone.yaml` (or `config/ground_station.yaml`).

### 2. A partner component during development, built from source

The same folder builds stand-alone against the partner SDK: when it is the top level, its
`CMakeLists.txt` calls `find_package(drone_sim REQUIRED)`. Its `Dockerfile` builds it
`FROM drone_sim/sim`.

Add a service with `build:` of the folder and `profiles: [partners, <name>]`:

- on board: in `docker/drone.compose.yml`, with `network_mode: service:core`;
- at the base station: in `docker-compose.yml`.

`scripts/up.sh` builds it:

```bash
COMPOSE_PROFILES=example_node scripts/up.sh 2   # + example_sidecar in each drone: swarm.bus/example_sidecar_drone<ID>
```

### 3. A partner hand-over: an image and the `.stl`

The same service, with `image:` and `pull_policy: never` instead of `build:`. We load the image
with `docker load -i`. A source delivery is the exception: the folder goes to
`external/<name>/source/` and the service keeps a `build:` of it. See `sim_spec.md` §18.

The example of a base-station plus on-board pair is
[`examples/partner_geocage/`](../examples/partner_geocage/); its README is the hand-over recipe.
In this repository its services also have a `build:`, so a clean clone needs nothing loaded:

```bash
COMPOSE_PROFILES=geocage scripts/up.sh 2   # + geocage and one geocage_store per drone
docker logs drone1-geocage_store-1         # geocage_store: geocage received, 4 vertices, 0–1500 m
```

## Profiles

Every partner service carries `profiles: [partners, <name>]`.

- Without a profile, the stack runs without partner components; consumers tolerate their absence.
- `COMPOSE_PROFILES=<name>` adds one, `COMPOSE_PROFILES=partners` adds all.
- Killing a partner container stops nothing else on its drone.
- Run `scripts/down.sh` before `scripts/up.sh` with other profiles: adding a profile to a running
  stack can crash the world.

## The partner SDK

A partner builds against the partner SDK only: `/opt/drone_sim` in the `drone_sim/sim` image
(`ARCHITECTURE.md` §4.4).

- `find_package(drone_sim)` gives our interface targets.
- Partner YAMLs `include:` `/opt/drone_sim/config/ether.yaml`.
- The contract version (`interfaces/VERSION`, also the image tag `drone_sim/sim:<VERSION>`) is a
  label that nothing checks. Rebuild when
  [`CHANGING.md`](../interfaces/stl/drone_sim/drone_bus/CHANGING.md) says a type changed.

## The release file

The release file saves a partner the ~90 min of builds:

```bash
scripts/release.sh   # dist/drone_sim-sim-<VERSION>.tar.gz (~160 MB) and its sha256; dist/ is git-ignored
```

The partner runs `docker load -i drone_sim-sim-<VERSION>.tar.gz`, then builds
`FROM drone_sim/sim:<VERSION>`. `scripts/up.sh` of the same repository version runs the loaded
image when `drone_sim/sen-base` is missing.

How the file reaches partners is not decided yet.

## Inspecting a drone bus

Each drone's bus is SEN session `drone<ID>`. Inspect it through the world's REST API on `:8080`
with `SELECT * FROM drone1.bus`; `scripts/smoke.sh` shows the calls.
