# Glossary

Every name a partner sees is made of whole words (`ARCHITECTURE.md` §8, "Naming"). This page lists the
few short forms that are allowed anyway, the partners' acronyms we use verbatim, the domain terms
that appear in comments and documents, and the project's own words. `scripts/check_names.py` reads
the first list: a short form that is not in it fails the check.

## Allowed short forms

Software words everybody knows: `id`, `ack`, `api`, `rest`, `json`, `yaml`, `url`, `Hz`, `sse`, `ui`.
SEN's own names: `sen`, `stl`, `ether`, `freqHz` (SEN's YAML key).
Partner-defined names, verbatim: `ACEM`, `AUCC`, `ERA2`, `aircraftera`, `acem_package`, `av_confinement`,
`aucc`, `route_replanning` and every name inside `external/wp4000/`, `external/wp5000/` (their typos too: `initialHeaing`,
`targetHeaing`, `maneouvering`).

Units (the SI rule): SI is the default and is written in the comment, the name says the quantity
(`lookaheadTime`, `range`, `separation`); a non-default unit or datum is spelled out in the name
(`maxBankDegrees`, `fieldOfViewDegrees`, `takeoff(altitudeAboveGround)`).

## Partner acronyms

Expanded where the partners' material expands them; the rest are the partners' own names and are
used as such until they give the expansion.

| Acronym | Meaning | Source |
|---|---|---|
| ACEM | the partners' escalation component (`acem_package.ACEM`: nominal → contingency → emergency → termination); expansion not given | `external/wp4000/stl/acem/acem.stl` |
| AUCC | the partners' WP5000 subsystem whose types we use (`aucc.*`: route, manage mission, DAA messages); expansion not given | `external/wp5000/stl/aucc/` |
| DAA | detect and avoid | `aucc.DaaModeType.detectAndAvoid` |
| IDD | the partners' interface document for AUCC (requirement ids `ERA2-AUCC-IDD-nnn` in their `.stl` comments); expansion not given | `aucc/*.stl` comments |
| WP4000 / WP5000 | the partners' names for their two `.stl` deliveries (`aircraftera`; `aucc`, `acem`, `av_confinement`); expansion not given | the partners' design documents folder names; `external/wp4000`, `external/wp5000` |
| ERA2 | the partners' project name | the partners' design documents, `.stl` comments |
| RPR FOM | Real-time Platform Reference Federation Object Model (SISO-STD-001); dropped 2026-10-06, for HLA take it from SEN | `airbus/sen/examples/packages/hla_fom/` |
| HLA | High Level Architecture (IEEE 1516), the standard the RPR FOM is written for | `airbus/sen/examples/packages/hla_fom/` |

## Domain terms (comments and documents)

| Term | Meaning |
|---|---|
| AGL / AMSL | above ground level / above mean sea level (altitudes are m AMSL unless the name says otherwise) |
| NED | north, east, down (body and velocity frame) |
| WGS84 | the geodetic datum of every latitude and longitude |
| C2 | command and control: the ground station ↔ drone link (`ground_station.heartbeat` advancing; read on board by a partner C2 component) |
| ISTAR | intelligence, surveillance, target acquisition and reconnaissance |
| EO/IR | electro-optical / infrared (the imaging sensor the `imaging_sensor` node stands in for) |
| GCS | ground control station: our `ground_station` |
| FCU | flight control unit: our `flight_controller` |
| ATC | air traffic control |
| HOTAS | hands on throttle and stick (the partner's `hotasBus`) |
| geocage | the global flight area: the lateral polygon plus the altitude band a drone must stay in (`config/world.yaml` `airspace`; the partner example `swarm.bus/geocage`) |

## Project words

| Word | Meaning |
|---|---|
| compose project | one drone as a Docker Compose project: the core container plus its on-board partner containers (`docker/drone.compose.yml`, project `drone<ID>`) |
| core | our container in a drone's compose project (the core container): airframe and our on-board nodes in one process |
| stand-in | our implementation of a partner component until theirs arrives (the `Sim*` classes, `packages/nodes/drone_nodes/`; none exists now; the partner-component map is `ARCHITECTURE.md` §4.3) |
| drone bus | `drone<ID>.bus`: one drone's on-board bus |
| swarm bus | `swarm.bus`: the air link — each drone's `drone<ID>` and the nodes others call (`waypoint_navigator_drone<ID>`), the ground station (`heartbeat`) and base-station components; operators call the drones' objects there directly |
| air link | `swarm.bus` carried by `ether` over IP (a mesh radio for real, the Docker network here); not simulated, no radio component |
| sim bus | `sim.bus`: the simulator's clock, truth and ground assets; on-board software never joins it |
| contract version | `interfaces/VERSION` (`/opt/drone_sim/VERSION`), also the image tag `drone_sim/sim:<VERSION>`; bumped when a contract or the partner SDK changes |
| partner SDK | `/opt/drone_sim` in `drone_sim/sim`: the only paths a partner build uses (`find_package(drone_sim)`, the `.stl` files, `config/ether.yaml`, our interface libraries, version); SDK = software development kit |
| release file | `dist/drone_sim-sim-<VERSION>.tar.gz` (`scripts/release.sh`): `drone_sim/sim:<VERSION>` for `docker load` |
| drone_sim | the project prefix: STL package, C++ namespace, images, network, labels |
