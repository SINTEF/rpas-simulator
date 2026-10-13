#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

# Add a drone to a running stack (docker/drone.compose.yml, compose project drone<id>).
#   scripts/spawn_drone.sh <id> [lat lon]     # e.g. scripts/spawn_drone.sh 3 59.914 10.752
# Same images, same config (config/drone.yaml) and same SEN_* environment for every drone; only
# DRONE_ID (and optionally the start position) differ. COMPOSE_PROFILES=partners (or =<name>, one component) adds the on-board partner containers.
# It never builds (--no-build): scripts/up.sh builds every image first. Remove it again with
#   DRONE_ID=<id> docker compose -p drone<id> -f docker/drone.compose.yml --profile '*' down
# (--profile '*': a plain `down` leaves the containers of profiles that are not active now)
# (or scripts/down.sh to stop everything). viz/serve.py (/spawn, /kill) runs the same commands.
set -eu
ID=${1:?usage: spawn_drone.sh <id> [lat lon]}
[[ $ID =~ ^[0-9]+$ ]] || { echo "id must be an integer" >&2; exit 1; }
if (($# >= 3)); then
  [[ $2 =~ ^-?[0-9]+(\.[0-9]+)?$ && $3 =~ ^-?[0-9]+(\.[0-9]+)?$ ]] || { echo "lat lon must be numbers" >&2; exit 1; }
  export START_LATITUDE=$2 START_LONGITUDE=$3
fi
cd "$(dirname "$0")/.."
export DRONE_SIM_ROOT=$PWD   # the repo's host path, for docker/drone.compose.yml's scenarios/ mount
DRONE_ID=$ID docker compose -p "drone$ID" -f docker/drone.compose.yml up -d --no-build
