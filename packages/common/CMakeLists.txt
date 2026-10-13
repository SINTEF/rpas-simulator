# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

# Header-only helpers: geo.h (flat earth), sen_helpers.h (first). Not a SEN package: no
# .stl, no objects. A package that needs it links `drone_sim_common` and includes "geo.h".
add_library(drone_sim_common INTERFACE)
target_include_directories(drone_sim_common INTERFACE ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(drone_sim_common INTERFACE drone_sim_interfaces)
