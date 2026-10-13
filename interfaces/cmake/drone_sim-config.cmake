# find_package(drone_sim): the simulator's contracts for a partner build (ARCHITECTURE.md section 4.4).
# Installed as /opt/drone_sim/cmake/drone_sim-config.cmake in the drone_sim/sim image, which sets
# CMAKE_PREFIX_PATH=/opt/drone_sim. After find_package(sen), then:
#   find_package(drone_sim REQUIRED)
#   add_sen_package(TARGET my_nodes ... DEPS drone_sim_interfaces)
# Targets: drone_sim_interfaces. No partner library: a component that needs the WP4000/WP5000 types
# builds them in its own image.
#
# The installed interface directories are added as they are, so the partner generates the same code
# from the same .stl files as our build; the libraries it links at build time are only for the link:
# at runtime every contract type comes from /opt/drone_sim/lib (one copy of each type). Outside `all`:
# only the targets a partner DEPS are compiled. SEN's get_external_interfaces is not used: it needs
# exported CMake targets, which add_sen_package does not create.
set(drone_sim_INSTALL_DIR ${CMAKE_CURRENT_LIST_DIR}/..)   # SEN's name for it (exportable_interfaces.md)
file(STRINGS ${drone_sim_INSTALL_DIR}/VERSION drone_sim_VERSION LIMIT_COUNT 1)

# A second find_package(drone_sim), in another directory of the same build, finds the targets there.
if(NOT TARGET drone_sim_interfaces)
  add_subdirectory(${drone_sim_INSTALL_DIR}/interfaces ${CMAKE_BINARY_DIR}/drone_sim EXCLUDE_FROM_ALL)
endif()
