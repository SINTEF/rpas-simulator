# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

add_sen_package(
  TARGET ground_station
  MAINTAINER "drone_sim_v4"
  VERSION "0.1.0"
  DESCRIPTION "ground station: the base station's heartbeat (C2 liveness)"
  SOURCES src/ground_station_impl.h src/ground_station_impl.cpp
  DEPS drone_sim_interfaces
  SCHEMA_PATH ${CMAKE_CURRENT_BINARY_DIR}
)
