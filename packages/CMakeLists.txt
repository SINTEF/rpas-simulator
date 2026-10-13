# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

# Every package in this repo, in one list (SEN's examples/packages/CMakeLists.txt pattern).
# Adding a package = one directory + one line here.
# A package must come after the packages it names in DEPS (their properties are copied at
# configure time). They name only interface packages and drone_sim_common (interfaces/ is added first);
# no package links another node's package.
set(packages
    common
    airframe
    world
    ground_station
    nodes/drone_nodes/example_node
    nodes/drone_nodes/waypoint_navigator
    nodes/ground_station_nodes/fleet_monitor
    nodes/sim_nodes/imaging_sensor
)

foreach(package ${packages})
  add_subdirectory(${package})
endforeach()

# No combined JSON schema for the configs: `sen_combine_schemas` needs a cross-directory custom
# command that the Makefile generator cannot express ("No rule to make target
# interfaces/drone_sim_interfaces.json"), which is why Sen's own examples/packages/CMakeLists.txt skips
# it for Unix Makefiles too. Each package's SCHEMA_PATH still keeps its <target>.json in the build
# tree instead of writing it into the source tree.
