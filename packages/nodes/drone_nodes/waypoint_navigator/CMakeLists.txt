# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

add_sen_package(
  TARGET waypoint_navigator
  TEST_TARGET waypoint_navigator_test_lib # static library with all symbols, used by the unit test
  MAINTAINER "drone_sim_v4"
  VERSION "0.1.0"
  DESCRIPTION "on-board waypoint navigation on swarm.bus: flies a Route through flight_controller.goToPosition()"
  SOURCES src/waypoint_navigator_impl.h src/waypoint_navigator_impl.cpp
  # No STL_FILES: the interface is the WaypointNavigator contract in interfaces/stl/drone_sim/swarm_bus/waypoint_navigator.stl.
  DEPS drone_sim_interfaces drone_sim_common   # bus contracts + geo.h (flat-earth distance)
  SCHEMA_PATH ${CMAKE_CURRENT_BINARY_DIR}
)

# Plain gtest like packages/airframe: the navigator flies the simulator's flight controller (and its world).
find_package(GTest QUIET)
if(GTest_FOUND)
  add_executable(waypoint_navigator_test test/waypoint_navigator_test.cpp)
  target_include_directories(waypoint_navigator_test PRIVATE src ${PROJECT_SOURCE_DIR}/packages/airframe/src
                                                             ${PROJECT_SOURCE_DIR}/packages/world/src)
  target_link_libraries(waypoint_navigator_test PRIVATE waypoint_navigator_test_lib airframe_test_lib world_test_lib
                                                        GTest::gtest_main)
  add_test(NAME waypoint_navigator_test COMMAND waypoint_navigator_test)
endif()
