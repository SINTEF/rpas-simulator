# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

# drone_sim/sim: one image for every service; the compose `command:` picks the YAML.
# No `# syntax=` directive on purpose: Docker's built-in BuildKit frontend (Docker >= 23) already has
# RUN --mount, and the directive would fetch the frontend from Docker Hub on every build (offline: fails).
# SEN_BASE: the SEN runtime image, built by scripts/up.sh from docker/Dockerfile.sen-base when missing;
# tagged by SEN commit, so this line is the one place a SEN bump renames it (up.sh and compose read it
# from here). A registry copy would be SEN_BASE=<registry>/sen-base:<commit> (ARCHITECTURE.md §9).
ARG SEN_BASE=drone_sim/sen-base:05da288e
FROM ${SEN_BASE}
# JOBS=16 compile jobs. A default WSL2 VM runs out of memory on a parallel build of the generated
# partner code and dies (2026-09-23): there, JOBS=1 scripts/up.sh.
ARG JOBS=16
WORKDIR /app

# Copied in dependency order, least often edited first: Docker redoes the steps from the first
# changed COPY on. Markdown is not in the context (.dockerignore), so a doc edit changes no layer.
COPY CMakeLists.txt ./
COPY interfaces/ interfaces/
# The partner SDK, /opt/drone_sim (ARCHITECTURE.md section 4.4): the one place a partner build reads,
# so /app can change freely. VERSION is a label (interfaces/VERSION); a partner image built FROM this
# one inherits it. The interface libraries and ether.yaml join it further down.
RUN mkdir -p /opt/drone_sim/cmake /opt/drone_sim/lib \
    && cp -a interfaces /opt/drone_sim/ \
    && cp interfaces/VERSION /opt/drone_sim/ \
    && cp interfaces/cmake/drone_sim-config.cmake /opt/drone_sim/cmake/
COPY packages/ packages/

# The CMake build tree outlives the image build in a BuildKit cache mount, so a rerun is an
# incremental make: one edited .cpp recompiles one package (a cache mount, not ccache, because make
# also skips the codegen and the links of everything unchanged). make cannot see a different SEN in
# /opt/sen, so a new SEN_BASE empties the tree first. `rm -rf lib`: only the libraries of this build
# reach the image (a removed package's stays in the cache otherwise); configure recreates the empty
# directory, objects and codegen stay cached, only the links rerun. The image gets a copy of the
# libraries; interfaces/ (one runtime copy of every contract type) goes to the SDK.
RUN --mount=type=cache,target=/app/build-cache,id=drone_sim-build,sharing=locked \
    cd /app/build-cache \
    && sen_id=$(find /opt/sen/include /opt/sen/lib -type f | sort | xargs cat | sha256sum | cut -c1-16) \
    && if [ "$(cat sen.id 2>/dev/null)" != "$sen_id" ]; then find . -mindepth 1 -delete && echo "$sen_id" > sen.id; fi \
    && rm -rf lib && cmake -S /app -B . -Dsen_DIR=/opt/sen/cmake/sen -DCMAKE_BUILD_TYPE=Release \
    && cmake --build . -j${JOBS} \
    && mkdir -p /app/build/lib && cp -a lib/*.so /app/build/lib/ \
    && mv /app/build/lib/libdrone_sim_interfaces.so /opt/drone_sim/lib/

# Last: a YAML edit rebuilds nothing. ether.yaml is also the SDK's (every partner YAML includes it).
COPY config/ config/
COPY config/ether.yaml /opt/drone_sim/config/
# Our packages land in build/lib with this SEN's CMake.
# CMAKE_PREFIX_PATH: a partner's find_package(drone_sim) finds /opt/drone_sim/cmake.
ENV LD_LIBRARY_PATH=/opt/drone_sim/lib:/app/build/lib:/opt/sen/bin:/opt/sen/lib \
    CMAKE_PREFIX_PATH=/opt/drone_sim
ENTRYPOINT ["sen", "run"]
