# partner_geocage — a SEN component delivered as a Docker image

This folder is what a **partner** has at its own site: source, a Dockerfile, two YAMLs. It is the
template to copy when you want to contribute a SEN component to the drone simulator **without
handing over your source**. You hand over two things: a built **Docker image** and the **`.stl`**
of your interface. The simulator team runs the image on board a drone, at the base station, or
both, by adding one block to a compose file; nothing of theirs is rebuilt or changed. (Not part of
the simulator's own build.)

The example is a geocage component (the global flight area: a polygon plus an altitude band), one
image with two placements that talk to each other over `swarm.bus`:

| Class | Placement | Object | Does |
|---|---|---|---|
| `geocage.GeocageService` | base station, `base.yaml` | `swarm.bus/geocage` | holds the geocage in force (`geocage`, start value `initialGeocage` from the YAML); `setGeocage(geocage) -> bool` replaces it (`false`, nothing changed, if it has fewer than 3 vertices or `minAltitude >= maxAltitude`) |
| `geocage.GeocageStore` | on board, `drone.yaml` | `drone<ID>.bus/geocage_store` | listens to `swarm.bus/geocage` and holds the last geocage it heard (`geocage`, `received`), also while the service is gone (`serviceUp`) |

## Files

```
stl/geocage/geocage.stl   the interface — hand this over verbatim; self-contained (no import)
src/                      the two implementations (GeocageServiceImpl, GeocageStoreImpl)
CMakeLists.txt            geocage_interfaces (the .stl) + geocage_nodes (the code)
drone.yaml  base.yaml     one SEN config per placement; bus names come from DRONE_ID
Dockerfile                builds FROM the simulator image, keeps only the libraries and the YAMLs
```

## Build and hand over

You need the simulator image, `drone_sim/sim` (the `DRONE_SIM` argument in the Dockerfile), first.
Either load the simulator team's release file (`docker load -i drone_sim-sim-<VERSION>.tar.gz`,
nothing to compile), or clone the simulator repo and
run `scripts/up.sh` there (~90 min the first time). It carries SEN (`/opt/sen`) and the **partner
SDK**, `/opt/drone_sim`:

```
/opt/drone_sim/
  VERSION                       the contract version (0.20.1); the image tag says the same
  cmake/drone_sim-config.cmake  find_package(drone_sim): drone_sim_interfaces
  interfaces/                   the .stl files you may import ("stl/drone_sim/drone_bus/flight_controller.stl", ...)
  config/ether.yaml             the transport: every YAML of yours includes it
  lib/                          the simulator's interface libraries (on LD_LIBRARY_PATH)
```

Build against it and nothing else: `include: [/opt/drone_sim/config/ether.yaml]` in each YAML, and
`find_package(drone_sim)` in `CMakeLists.txt` when your component reads the simulator's objects
(`flight_controller`, `drone<ID>`, ...; the image sets `CMAKE_PREFIX_PATH=/opt/drone_sim`). The geocage
reads none of them, so its `CMakeLists.txt` needs only `find_package(sen)`. Everything else in the
image belongs to the simulator and may change in any version. Then, here:

```bash
docker build -t partner/geocage:0.6.0 .                              # single-job build
docker save partner/geocage:0.6.0 | gzip > geocage-0.6.0.tar.gz      # the file you hand over
```

Hand over: `geocage-0.6.0.tar.gz`, `stl/geocage/geocage.stl`, and a short note: image tag, the
drone_sim version it was built against (`docker run --rm --entrypoint cat partner/geocage:0.6.0
/opt/drone_sim/VERSION`), classes, the `[static]` knobs
(`initialGeocage`, `swarmBus`), and which YAML is which placement (`/partner/geocage/base.yaml`,
`/partner/geocage/drone.yaml`). No registry, no accounts.

## How the simulator runs it

The simulator team loads the file (`docker load -i geocage-0.6.0.tar.gz`), keeps the `.stl` in
`external/geocage/` (as the interface document: nothing of theirs compiles it; REST and the UI read
the objects without it), and adds one compose block per placement, both under
`profiles: [partners, geocage]`:

```yaml
# docker/drone.compose.yml — on board, in every drone's compose project
geocage_store:
  profiles: [partners, geocage]
  image: partner/geocage:0.6.0
  pull_policy: never
  network_mode: service:core        # the drone's own network namespace
  labels: { drone_sim.drone: "${DRONE_ID}" }
  environment: *env                 # DRONE_ID, SEN_ETHER_*
  command: /partner/geocage/drone.yaml

# docker-compose.yml — at the base station
geocage:
  profiles: [partners, geocage]
  image: partner/geocage:0.6.0
  pull_policy: never
  hostname: geocage
  environment: *env
  command: /partner/geocage/base.yaml
```

(In the simulator's repo the two blocks also have `build: { context: …/examples/partner_geocage }`,
because this source is there: `scripts/up.sh` builds the image when the profile is on.)
`COMPOSE_PROFILES=geocage scripts/up.sh 2` then starts it with two drones. Watch it:
`docker logs drone1-geocage_store-1` prints `geocage_store: geocage received, 4 vertices, 0–1500 m`,
the world's REST shows `swarm.bus/geocage` and `drone1.bus/geocage_store` (`geocage`, `received`,
`serviceUp`), and the UI draws the geocage.

## Rules

1. **Build `FROM drone_sim/sim`, against `/opt/drone_sim` only.** Same SEN, same ether config, same
   contracts. The image inherits `/opt/drone_sim/VERSION`, a label nothing checks. When the
   simulator's `CHANGING.md` says a type changed, rebuild: SEN converts mismatched types silently.
2. **One build of the contract types.** If you read the simulator's objects, take its targets from
   `find_package(drone_sim)` (`DEPS drone_sim_interfaces`), never a copy of their `.stl` files, and
   ship only your own libraries: at runtime every contract type comes from `/opt/drone_sim/lib`
   (the WP4000/WP5000 types are not in it: a partner that needs them builds them in its own image). A change to an ERA2
   partner `.stl` (`aucc`, `acem_package`, …) goes to that partner's repository (WP4000, WP5000);
   the simulator team pins the new commit and everybody rebuilds.
3. **Your two halves talk over `swarm.bus`.** All traffic between the drones and the base station
   is on `swarm.bus`: your on-board container may open it (its air link) as well as its drone bus
   (`drone@env(DRONE_ID).bus`), and publishes on its drone bus, or on `swarm.bus` as `<name>_drone<ID>`
   when another drone or the base station reads or calls it (the placement rule, `ARCHITECTURE.md` §3;
   the geocage store has no such reader, so it stays on its drone bus); your base-station
   container publishes on `swarm.bus`. Never open another drone's bus or `sim.bus`, and never
   hard-code a drone id: it comes from `DRONE_ID` in the YAML.
4. **One query per class per process**, and no `SELECT *` beside a typed query (a known bug of
   the pinned SEN freezes an object matched by two different queries in one process). The store
   holds exactly one: `geocage.GeocageService` on `swarm.bus`.
5. **Tolerate late and lost peers.** Containers start in any order and the base station may
   restart: a subscription's list is empty until the peer appears (the store keeps the last
   geocage and says `serviceUp = false`).
6. **A changed `.stl` is a new image version** (`partner/geocage:0.6.0`), handed over with the new `.stl`.

The SEN patterns used here (a `[static]` from YAML, `setNext*` in `registered()`, a method impl
that validates and stages, a typed subscription kept as a member, `SEN_EXPORT_CLASS`) are the ones
of the simulator's own nodes; its `packages/nodes/README.md` explains each.
