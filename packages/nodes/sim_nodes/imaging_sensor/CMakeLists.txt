# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

# Simulated sensor: implements the contract class drone_sim.Sensor (interfaces/stl/drone_sim/drone_bus/
# sensor.stl); its own .stl only adds the simulator's knobs (SimSensor : extends Sensor).
add_sen_package(
  TARGET imaging_sensor
  MAINTAINER "drone_sim_v4"
  VERSION "0.1.0"
  DESCRIPTION "sim node: EO/IR payload stand-in, tracks from the ground-asset truth"
  SOURCES src/imaging_sensor_impl.h src/imaging_sensor_impl.cpp
  STL_FILES stl/drone_sim/sim/imaging_sensor.stl
  DEPS drone_sim_interfaces drone_sim_common   # bus contracts + geo.h (flat-earth distance)
  SCHEMA_PATH ${CMAKE_CURRENT_BINARY_DIR}
)
