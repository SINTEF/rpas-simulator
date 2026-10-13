#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

# Native run: world + ground_station + N drones as background `sen run` processes (same YAMLs as compose).
#   scripts/run_native.sh [N]      # default N=2; Ctrl-C stops everything
# Env: SEN_INSTALL (your SEN install, default $HOME/SEN/install), SEN (launcher, default
#      $SEN_INSTALL/bin/sen), SEN_ETHER_DISCOVERY_PORT (default 47120),
#      RECORD=true to record sim.bus + swarm.bus from the world process.
set -u
N=${1:-2}
cd "$(dirname "$0")/.."

if [[ ! -d build/lib ]]; then
  echo "build/lib missing — build first:" >&2
  echo "  cmake -S . -B build -Dsen_DIR=\$SEN_INSTALL/cmake/sen -DCMAKE_BUILD_TYPE=Release" >&2
  echo "  cmake --build build -j2" >&2
  exit 1
fi

SEN_INSTALL=${SEN_INSTALL:-$HOME/SEN/install}
SEN=${SEN:-$SEN_INSTALL/bin/sen}
# Our packages land in build/lib with this SEN.
# install/bin + install/lib: the SEN runtime itself.
export LD_LIBRARY_PATH=$PWD/build/lib:$SEN_INSTALL/bin:$SEN_INSTALL/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
export SEN_ETHER_DISCOVERY_PORT=${SEN_ETHER_DISCOVERY_PORT:-47120}
mkdir -p build/logs

PIDS=()
start() { # NAME YAML — setsid gives each `sen` (and its cli_run child) its own process group
  local name=$1 yaml=$2
  setsid "$SEN" run "$yaml" >"build/logs/$name.log" 2>&1 &
  PIDS+=($!)
  echo "started $name  pid $!  log build/logs/$name.log"
}

stop() {
  trap '' INT TERM
  echo; echo "stopping ${#PIDS[@]} processes..."
  for pid in "${PIDS[@]}"; do kill -TERM -- "-$pid" 2>/dev/null; done
  for _ in $(seq 50); do  # up to 5 s, then SIGKILL the groups
    alive=0
    for pid in "${PIDS[@]}"; do pgrep -g "$pid" >/dev/null && alive=1; done
    ((alive)) || break
    sleep 0.1
  done
  for pid in "${PIDS[@]}"; do kill -KILL -- "-$pid" 2>/dev/null; done
  wait 2>/dev/null
  echo "all stopped"
}
trap stop EXIT
trap 'exit 130' INT TERM

start world config/world.yaml
start ground_station config/ground_station.yaml
for i in $(seq 1 "$N"); do
  DRONE_ID=$i start "drone$i" config/drone.yaml
done
echo "REST: http://localhost:${REST_PORT:-8080}   (Ctrl-C to stop)"
wait
