# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

add_sen_package(
  TARGET airframe
  TEST_TARGET airframe_test_lib # static library with all symbols, used by the unit test
  MAINTAINER "drone_sim_v4"
  VERSION "0.1.0"
  DESCRIPTION "Kinematic fixed-wing airframe + flight controller, its truth (sim.bus) and its public face (swarm.bus)"
  SOURCES src/flight_controller_impl.h src/flight_controller_impl.cpp src/drone_truth_impl.h src/drone_truth_impl.cpp
          src/drone_link_impl.h src/drone_link_impl.cpp src/kinematics.h
  STL_FILES stl/drone_sim/sim/airframe.stl
  DEPS drone_sim_interfaces drone_sim_common
  SCHEMA_PATH ${CMAKE_CURRENT_BINARY_DIR}
)

# Plain gtest like packages/world (see there); the world object runs next to the flight controller.
find_package(GTest QUIET)
if(GTest_FOUND)
  add_executable(flight_controller_test test/flight_controller_test.cpp)
  target_include_directories(flight_controller_test PRIVATE src ${PROJECT_SOURCE_DIR}/packages/world/src)
  target_link_libraries(flight_controller_test PRIVATE airframe_test_lib world_test_lib GTest::gtest_main)
  add_test(NAME flight_controller_test COMMAND flight_controller_test)
endif()
