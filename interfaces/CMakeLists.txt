# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

# Every contract the simulator publishes, and the partner SDK's content: this directory is installed
# as /opt/drone_sim/interfaces and added by find_package(drone_sim) (cmake/drone_sim-config.cmake), so
# it builds the same in our tree and in a partner's. Its VERSION is the contract version.
#
# drone_sim_interfaces: the skeleton's bus contracts, and only those: one STL-only package so no type
# is registered twice. No partner dependency. A package takes it with `DEPS drone_sim_interfaces`, which propagates
# both the codegen import path and the generated include directory. Its own .stl files then live in
# the package itself.
#
# The stl/drone_sim/... folders mirror the import path, which is Sen's rule for interfaces that may be
# exported (docs/howto_guides/exportable_interfaces.md): a file imports
# "stl/drone_sim/common/types.stl" and a source includes "stl/drone_sim/drone_bus/flight_controller.stl.h".
file(STRINGS ${CMAKE_CURRENT_LIST_DIR}/VERSION drone_sim_contract_version LIMIT_COUNT 1)

add_sen_package(
  TARGET drone_sim_interfaces
  MAINTAINER "drone_sim_v4"
  VERSION ${drone_sim_contract_version}
  DESCRIPTION "Bus contracts: drone bus, swarm bus, sim bus"
  STL_FILES
    stl/drone_sim/common/types.stl
    stl/drone_sim/drone_bus/flight_controller.stl
    stl/drone_sim/drone_bus/sensor.stl
    stl/drone_sim/swarm_bus/drone_link.stl
    stl/drone_sim/swarm_bus/ground_station.stl
    stl/drone_sim/swarm_bus/waypoint_navigator.stl  # implemented by packages/nodes/drone_nodes/waypoint_navigator
    stl/drone_sim/sim_bus/world.stl
    stl/drone_sim/sim_bus/truth.stl
    stl/drone_sim/sim_bus/ground_asset.stl
  CODEGEN_SETTINGS codegen_settings.json   # DroneLink's forwarded methods are deferred (promise-based)
  SCHEMA_PATH ${CMAKE_CURRENT_BINARY_DIR}
  PUBLIC_SYMBOLS
)
