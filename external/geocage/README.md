# geocage — received partner component (the global flight area)

What we received from the partner (here: our own example, `examples/partner_geocage/`, played as the
partner). `sim_spec.md` §18 has the rules; `ARCHITECTURE.md` §4.4 the design.

| Item | Value |
|---|---|
| Image | `partner/geocage:0.6.0` — `docker load -i geocage-0.6.0.tar.gz` (a file, no registry) |
| Built against | drone_sim `0.20.1` (`/opt/drone_sim/VERSION` in the image, `FROM drone_sim/sim` of 2026-10-12) |
| `.stl` | `stl/geocage/geocage.stl`, verbatim; `sha256sum` `6df8144d74628bafaa641c9843dccae46a5f48381459ce8afb15dce435f71db7` |

Classes and placements (one image, the compose `command:` picks the YAML):

| Class | Where | Compose service | YAML | Object |
|---|---|---|---|---|
| `geocage.GeocageService` | base station | `geocage` in `docker-compose.yml` | `/partner/geocage/base.yaml` | `swarm.bus/geocage`: `geocage` (`[confirmed]`, start value `initialGeocage` [static]), `setGeocage(geocage) -> bool` |
| `geocage.GeocageStore` | on board | `geocage_store` in `docker/drone.compose.yml` | `/partner/geocage/drone.yaml` | `drone<ID>.bus/geocage_store`: `geocage` (the last one heard on `swarm.bus`), `received`, `serviceUp`, `swarmBus` [static] |

Both services carry `profiles: [partners, geocage]`: `COMPOSE_PROFILES=geocage scripts/up.sh 2`.

Nothing of ours compiles this `.stl` (no `CMakeLists.txt` here): the two halves talk to each other
over `swarm.bus` directly, and REST and the UI read the objects without it (SEN sends remote
types). It is kept as the interface document. A new `.stl` comes with a new image tag: replace the
file, bump the tag in both compose files and here.
