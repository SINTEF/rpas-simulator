#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

# Stop the whole stack: every drone compose project (found by its drone_sim.drone label), then world, ground_station, web.
# --profile '*': partner services too, whether or not COMPOSE_PROFILES is set now.
cd "$(dirname "$0")/.."
for ID in $(docker ps -a --filter label=drone_sim.drone --format '{{.Label "drone_sim.drone"}}' | sort -u); do
  DRONE_ID=$ID docker compose -p "drone$ID" -f docker/drone.compose.yml --profile '*' down
done
docker compose --profile '*' down
