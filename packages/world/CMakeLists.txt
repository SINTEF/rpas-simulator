# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

add_sen_package(
  TARGET world
  TEST_TARGET world_test_lib # static library with all symbols, used by the unit test
  MAINTAINER "drone_sim_v4"
  VERSION "0.1.0"
  DESCRIPTION "sim clock, environment, ground assets"
  SOURCES src/world_impl.h src/world_impl.cpp src/ground_asset_impl.h src/ground_asset_impl.cpp
  DEPS drone_sim_interfaces drone_sim_common
  SCHEMA_PATH ${CMAKE_CURRENT_BINARY_DIR}
)

# The installed sen-config.cmake exports no add_sen_unit_test_suite and ships no gtest, so the
# test is a plain gtest executable; QUIET keeps partners without gtest building.
find_package(GTest QUIET)
if(GTest_FOUND)
  add_executable(world_test test/world_test.cpp)
  target_include_directories(world_test PRIVATE src)
  target_link_libraries(world_test PRIVATE world_test_lib GTest::gtest_main)
  add_test(NAME world_test COMMAND world_test)
endif()
