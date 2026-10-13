# sim_nodes/

Simulator stand-ins for hardware a real vehicle would have: they publish a drone-bus contract
class (the contract `.stl` lives in `interfaces/stl/drone_sim/drone_bus/`; the package's own `.stl`
adds only simulator knobs through `SimX : extends X`) but are allowed to *read* `sim.bus` for
the truth they fake — the only node kind that may (`ARCHITECTURE.md` §4.3).
`imaging_sensor` implements `sensor.stl`: `Sensor.tracks` lists every ground asset within `range`
slant range and inside a downward-looking cone of `fieldOfViewDegrees` (fixed mount, vehicle attitude ignored), stamped
with the flight controller's `stateTime`. It holds `SELECT drone_sim.GroundAsset FROM sim.bus` next to the
airframe's `SELECT drone_sim.World`: disjoint typed interests, which is the one shape that is safe
beside another interest on a shared bus — a workaround for the kernel bug at SEN `05da288e`
(`ARCHITECTURE.md` §9 has the full description); remove when upstream fixes it. A package here is built like any
other node (`packages/nodes/README.md`).
