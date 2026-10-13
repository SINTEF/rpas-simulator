# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

# partner/example_node: this template as an on-board partner container (ARCHITECTURE.md section 4.4), the
# shape of examples/partner_geocage/Dockerfile. Built FROM the simulator's image, against its partner SDK
# (/opt/drone_sim) only; the image inherits /opt/drone_sim/VERSION:
#   docker build -t partner/example_node:0.1.0 .      (scripts/up.sh does it for the example_node profile)
ARG DRONE_SIM=drone_sim/sim

# Build stage: CMakeLists.txt finds sen (/opt/sen) and drone_sim (CMAKE_PREFIX_PATH=/opt/drone_sim).
# One job (-j1): parallel builds can run a small machine out of memory.
FROM ${DRONE_SIM} AS build
COPY . /src
RUN cmake -S /src -B /build -Dsen_DIR=/opt/sen/cmake/sen -DCMAKE_BUILD_TYPE=Release \
    && cmake --build /build -j1

# Runtime: the simulator's image plus our library and YAML. No source. Our library comes first on the
# path (the image also holds the simulator's own build of example_node).
FROM ${DRONE_SIM}
COPY --from=build /build/lib/libexample_node.so /partner/example_node/
COPY drone.yaml /partner/example_node/
ENV LD_LIBRARY_PATH=/partner/example_node:${LD_LIBRARY_PATH}
