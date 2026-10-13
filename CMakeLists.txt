# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

cmake_minimum_required(VERSION 3.20 FATAL_ERROR)

project(drone_sim_v4 VERSION 0.1.0 LANGUAGES CXX C)

# SEN's CMake config lives at <install>/cmake/sen: pass -Dsen_DIR=... or set SEN_PATH.
if(DEFINED ENV{SEN_PATH})
  list(APPEND CMAKE_PREFIX_PATH "$ENV{SEN_PATH}/cmake")
endif()

# Sen runs clang-tidy on every target it creates when this is OFF. Partners should not have to
# install clang-tidy (and we do not want it on generated code), so it stays ON; formatting is
# enforced instead by Sen's own .clang-format, copied into this repo.
set(SEN_DISABLE_CLANG_TIDY ON CACHE BOOL "do not run clang-tidy as part of the build")
find_package(sen REQUIRED)

enable_testing()  # ctest --test-dir build; tests build only where gtest is installed (find_package(GTest QUIET))

# The ERA2 WP4000/WP5000 interfaces (ARCHITECTURE.md section 4.3): STL-only targets wp4000, wp5000.
# They are the partners' own repositories, unpacked or cloned into the git-ignored external/: not open
# source, not in this repository. Without them the rest builds; nothing of ours uses a partner type.
set(wp4000_dir ${CMAKE_CURRENT_SOURCE_DIR}/external/wp4000)
if(EXISTS ${wp4000_dir}/CMakeLists.txt)
  file(STRINGS ${wp4000_dir}/stl/aircraftera/aircraftera.stl wp4000_rpr_imports REGEX "fom/rpr")
  if(wp4000_rpr_imports)
    message(FATAL_ERROR "external/wp4000 predates 2026-10-06: aircraftera.stl still needs the RPR FOM, "
                        "which is gone from this repository; update external/wp4000")
  endif()
  add_subdirectory(external/wp4000)
else()
  message(STATUS "external/wp4000 not found: WP4000 partner interfaces not built")
endif()
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/external/wp5000/CMakeLists.txt)
  add_subdirectory(external/wp5000)
else()
  message(STATUS "external/wp5000 not found: WP5000 partner interfaces not built")
endif()

# The contracts: drone_sim_interfaces (interfaces/CMakeLists.txt); the same directory is the
# partner SDK's find_package(drone_sim).
add_subdirectory(interfaces)

add_subdirectory(packages)
