# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

# partner/geocage: the geocage component as a runnable image. Built FROM the simulator's image, which
# carries SEN (/opt/sen) and the partner SDK (/opt/drone_sim: ether.yaml and the version, which this image
# inherits):
#   docker build -t partner/geocage:0.6.0 .
ARG DRONE_SIM=drone_sim/sim

# Build stage: compile against /opt/sen. One job (-j1): parallel builds can run a small machine out of
# memory.
FROM ${DRONE_SIM} AS build
COPY . /src
RUN cmake -S /src -B /build -Dsen_DIR=/opt/sen/cmake/sen -DCMAKE_BUILD_TYPE=Release \
    && cmake --build /build -j1

# Runtime: the simulator's image plus our two libraries and two YAMLs. No source.
FROM ${DRONE_SIM}
COPY --from=build /build/lib/libgeocage_interfaces.so /build/lib/libgeocage_nodes.so /partner/geocage/
COPY drone.yaml base.yaml /partner/geocage/
ENV LD_LIBRARY_PATH=/partner/geocage:${LD_LIBRARY_PATH}
