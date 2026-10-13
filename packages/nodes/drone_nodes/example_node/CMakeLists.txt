# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

# Built two ways from this one file: in our tree (packages/CMakeLists.txt), or on its own against the
# partner SDK (/opt/drone_sim in drone_sim/sim; its Dockerfile does that): the block below runs only then.
# (Not `if(PROJECT_IS_TOP_LEVEL)`: before this folder's own project() it holds the including project's value.)
if(CMAKE_CURRENT_SOURCE_DIR STREQUAL CMAKE_SOURCE_DIR)
  cmake_minimum_required(VERSION 3.20 FATAL_ERROR)
  project(example_node LANGUAGES CXX C)
  set(SEN_DISABLE_CLANG_TIDY ON CACHE BOOL "do not run clang-tidy as part of the build")
  find_package(sen REQUIRED)
  find_package(drone_sim REQUIRED)   # drone_sim_interfaces
endif()

# TARGET is the package name: the YAML says `imports: [example_node]` and
# `class: example_node.ExampleNodeImpl`, and the C++ namespace must be example_node too.
add_sen_package(
  TARGET example_node
  MAINTAINER "drone_sim_v4"
  VERSION "0.1.0"
  DESCRIPTION "template on-board node"
  SOURCES src/example_node_impl.h src/example_node_impl.cpp
  STL_FILES stl/drone_sim/nodes/example_node.stl   # this node's own interface
  DEPS drone_sim_interfaces                        # the bus contracts (FlightController, CommandAck, ...)
  SCHEMA_PATH ${CMAKE_CURRENT_BINARY_DIR}
)
