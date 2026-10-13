# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

# The geocage partner component, built inside the drone_sim/sim image (see Dockerfile): SEN is at /opt/sen.
cmake_minimum_required(VERSION 3.20 FATAL_ERROR)
project(partner_geocage VERSION 0.6.0 LANGUAGES CXX C)

set(SEN_DISABLE_CLANG_TIDY ON CACHE BOOL "do not run clang-tidy as part of the build")
find_package(sen REQUIRED)

# No find_package(drone_sim): this component reads none of the simulator's contracts, it talks only to
# its own other half (over swarm.bus). A component that reads flight_controller or drone<ID> adds it and
# `DEPS drone_sim_interfaces` (the partner SDK, /opt/drone_sim).

# Our interface, STL only: the file we hand over with the image.
add_sen_package(
  TARGET geocage_interfaces
  MAINTAINER "partner"
  VERSION "0.6.0"
  DESCRIPTION "geocage: interface"
  STL_FILES stl/geocage/geocage.stl
  SCHEMA_PATH ${CMAKE_CURRENT_BINARY_DIR}
  PUBLIC_SYMBOLS
)

# Our implementation. TARGET = the YAML's `imports:` name = the C++ namespace.
add_sen_package(
  TARGET geocage_nodes
  MAINTAINER "partner"
  VERSION "0.6.0"
  DESCRIPTION "geocage: geocage service (base station) and geocage store (on board)"
  SOURCES src/geocage_service_impl.h src/geocage_service_impl.cpp src/geocage_store_impl.h src/geocage_store_impl.cpp
  DEPS geocage_interfaces
  SCHEMA_PATH ${CMAKE_CURRENT_BINARY_DIR}
)
