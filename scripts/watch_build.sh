#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

# Rebuild the project in the devmachine whenever a CMake, C++ or STL file changes.
# Needs inotify-tools on the host. BUILD_DIR and JOBS override the defaults.
set -euo pipefail
cd "$(dirname "$(realpath "$0")")/.."   # the repo root
BUILD_DIR=${BUILD_DIR:-build-docker}
JOBS=${JOBS:-1}   # more runs a WSL2 VM out of memory

# Configure and build everything; stdin from /dev/null so docker does not eat inotify's events.
# Use run_devmachine.sh to ensure the build runs in the same environment as the simulator.
build() {
  ./scripts/run_devmachine.sh "$PWD" -- bash -c "cmake -S . -B '$BUILD_DIR' -DCMAKE_BUILD_TYPE=Release && cmake --build '$BUILD_DIR' -j $JOBS" </dev/null
}

# Trigger an initial build, otherwise we have to force a change for the build to kick off.
# `|| true` here and below: a failed build must not end the watcher (set -e).
build || true

inotifywait -m -r -q -e close_write,create,delete,move --format '%w%f' \
    --exclude '(^|/)(\.git|build[^/]*|node_modules)(/|$)' . |
  while read -r file; do
    [[ $file =~ (CMakeLists\.txt|\.cmake|\.cpp|\.h|\.stl)$ ]] || continue
    while read -r -t 1 _; do :; done   # let the burst of changes settle
    build || true
  done
