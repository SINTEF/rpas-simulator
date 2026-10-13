# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

add_sen_package(
  TARGET fleet_monitor
  MAINTAINER "drone_sim_v4"
  VERSION "0.1.0"
  DESCRIPTION "ground station node: fleet liveness from DroneLink heartbeats"
  SOURCES src/fleet_monitor_impl.h src/fleet_monitor_impl.cpp
  STL_FILES stl/drone_sim/nodes/fleet_monitor.stl
  DEPS drone_sim_interfaces
  SCHEMA_PATH ${CMAKE_CURRENT_BINARY_DIR}
)
