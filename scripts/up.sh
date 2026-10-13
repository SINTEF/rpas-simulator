#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

# Bring up the stack: world, ground_station, web (docker-compose.yml, built if needed), then N drone compose projects.
#   scripts/up.sh [N]                          # default N=2; http://localhost:8000
#   COMPOSE_PROFILES=partners scripts/up.sh 2      # with every partner component (ARCHITECTURE.md §4.4)
#   COMPOSE_PROFILES=geocage scripts/up.sh 2       # with one (the profile = the component's name)
#   JOBS=1 scripts/up.sh                       # compile parallelism (default 16; a default WSL2 VM needs 1)
# More drones later: scripts/spawn_drone.sh <id> [lat lon], or the UI's spawn. Stop: scripts/down.sh.
# Works from a fresh clone: every image is built here when missing or outdated, one at a time
# (two C++ builds side by side run a default WSL2 VM out of memory): sen-base, drone_sim/sim, web, then
# the active partner components delivered as source; or, with only our release file loaded
# (docker load -i drone_sim-sim-<VERSION>.tar.gz, scripts/release.sh), nothing of ours is compiled.
# Starting drones never builds (spawn_drone.sh, the UI).
set -eu
N=${1:-2}
# build SERVICE IMAGE (web only): rebuild if needed; offline (its base image cannot be looked up on Docker Hub)
# an existing image is used as it is, with a warning, instead of stopping the whole bring-up.
build() {
  docker compose build "$1" && return
  docker image inspect "$2" >/dev/null 2>&1 || { echo "== building $2 failed and no such image exists" >&2; exit 1; }
  echo "== building $2 failed (offline?): using the existing image, local edits for it are not in" >&2
}
cd "$(dirname "$0")/.."
export DRONE_SIM_ROOT=$PWD   # host path of the repo, for the drones' scenarios/ mount (web spawns drones too)
# the top bar's version (viz/serve.py): the tag, or the sha1 plus -dirty with uncommitted changes
SIM_VERSION=$(git describe --tags --always --dirty 2>/dev/null || echo unknown); export SIM_VERSION

# drone_sim/sim is tagged with the contract version too (ARCHITECTURE.md §4.4): partners build FROM it.
VERSION=$(cat interfaces/VERSION)
# drone_sim/sen-base: docker/Dockerfile names the tag (SEN commit); built once per machine and SEN pin.
# A machine that loaded our release file (scripts/release.sh) instead runs drone_sim/sim:<VERSION> as it is.
SEN_BASE=${SEN_BASE:-$(sed -n 's/^ARG SEN_BASE=//p' docker/Dockerfile)}
if [[ $SEN_BASE == drone_sim/sen-base:* ]] && ! docker image inspect "$SEN_BASE" >/dev/null 2>&1 \
   && docker image inspect "drone_sim/sim:$VERSION" >/dev/null 2>&1; then
  echo "== $SEN_BASE missing: running the loaded drone_sim/sim:$VERSION, nothing is compiled" >&2
  docker tag "drone_sim/sim:$VERSION" drone_sim/sim
else
  if [[ $SEN_BASE == drone_sim/sen-base:* ]] && ! docker image inspect "$SEN_BASE" >/dev/null 2>&1; then
    LOADED=$(docker image ls --format '{{.Tag}}' drone_sim/sim | grep -v -x -e latest -e "$VERSION" | paste -sd' ')
    [[ -z $LOADED ]] || echo "== drone_sim/sim $LOADED is loaded, this checkout is $VERSION: a full build starts" >&2
    echo "== $SEN_BASE missing: one-time SEN build, ~1 h with JOBS=1, less with more jobs" >&2
    docker build -f docker/Dockerfile.sen-base --build-arg JOBS="${JOBS:-16}" -t "$SEN_BASE" docker
  fi
  docker compose build world   # drone_sim/sim, before anything built FROM it; a no-op when nothing changed. No
  # fallback here: its base is local, so a failure is a real compile error, never "offline"
  docker tag drone_sim/sim "drone_sim/sim:$VERSION"
fi
build web drone_sim/web       # drone_sim/web (Python, no C++)

# Partner components delivered as source (a `build:` beside the `image:`, ARCHITECTURE.md §4.4): built
# FROM the drone_sim/sim above, one service at a time (a plain `docker compose build` runs them in
# parallel), in both compose files; only services of the active profiles.
DRONE_COMPOSE=(env DRONE_ID=0 docker compose -f docker/drone.compose.yml)
source_built() { # COMPOSE_COMMAND... -> active services with a build: whose image is not ours
  "$@" config --format json | python3 -c 'import json, sys
for name, service in json.load(sys.stdin)["services"].items():
    if "build" in service and not service.get("image", "").startswith("drone_sim/"): print(name)'
}
for SERVICE in $(source_built docker compose); do docker compose build "$SERVICE"; done
for SERVICE in $(source_built "${DRONE_COMPOSE[@]}"); do "${DRONE_COMPOSE[@]}" build "$SERVICE"; done

docker compose up -d --no-build
for i in $(seq 1 "$N"); do scripts/spawn_drone.sh "$i"; done
