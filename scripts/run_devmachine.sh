#!/usr/bin/env bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

# Open a SEN development shell over a local source checkout, or run one command in it.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: run_devmachine.sh [SOURCE_DIR] [-- COMMAND...]
       run_devmachine.sh --check-health [EXPECTED_DRONES]

Mount SOURCE_DIR (default: the current directory) at /workspace and open Bash in drone_sim/sen-dev.
With -- COMMAND, run COMMAND there instead and exit with its status. COMMAND is not run through a
shell: use -- bash -c 'a && b' for shell syntax.
Files and build artifacts persist on the host and use your UID/GID.
--check-health checks the simulator stack on the host without opening a shell.

Environment:
  SEN_BASE       Base SDK image (default: drone_sim/sen-base:05da288e).
  SEN_DEV_IMAGE  Development image tag (default: drone_sim/sen-dev).

The image adds Docker CLI/Compose and check_health to SEN_BASE. The container uses
host networking and the host Docker socket.

Inside the container:
  cmake -S . -B build-docker -DCMAKE_BUILD_TYPE=Release
  cmake --build build-docker -j2
  sen run config.yaml
  check_health                     # simulator stack, from any working directory
EOF
}

repo_dir=$(cd -- "$(dirname -- "$(realpath -- "${BASH_SOURCE[0]}")")/.." && pwd -P)
case ${1:-} in
  -h|--help) usage; exit 0 ;;
  --check-health) shift; exec "$repo_dir/scripts/check_health.sh" "$@" ;;
esac

source_dir=.
if [[ $# -gt 0 && $1 != -- ]]; then source_dir=$1; shift; fi
cmd=()
if [[ ${1:-} == -- ]]; then
  shift; cmd=("$@"); set --
  (( ${#cmd[@]} )) || { echo "run_devmachine.sh: missing COMMAND after --" >&2; exit 2; }
fi
(( $# == 0 )) || { usage >&2; exit 2; }
source_dir=$(cd -- "$source_dir" && pwd -P)

base_image=${SEN_BASE:-drone_sim/sen-base:05da288e}
image=${SEN_DEV_IMAGE:-drone_sim/sen-dev}
socket=/var/run/docker.sock
if ! docker image inspect "$base_image" >/dev/null 2>&1; then
  echo "Base image $base_image is missing: build it with scripts/up.sh, or from $repo_dir:" >&2
  echo "  docker build -f docker/Dockerfile.sen-base -t $base_image docker" >&2
  exit 1
fi
[[ -S $socket ]] || { echo "The Docker socket $socket is required" >&2; exit 1; }

# Build context: only the Dockerfile and the health script, not the checkout. With a command, the
# build is quiet so only the command's output shows (errors still reach stderr).
quiet=
args=(--noprofile --norc)
if (( ${#cmd[@]} )); then
  quiet=--quiet
  args+=(-c 'exec "$@"' devmachine "${cmd[@]}")
fi
tar -C "$repo_dir" -cf - docker/Dockerfile.devmachine scripts/check_health.py |
  docker build $quiet --build-arg "SEN_BASE=$base_image" -t "$image" -f docker/Dockerfile.devmachine - >/dev/null

tty=(-i)
if [[ -t 0 && -t 1 ]]; then tty+=(-t); fi
(( ${#cmd[@]} )) || echo "SEN development shell: $source_dir -> /workspace ($image)"
exec docker run --rm --init --pull=never "${tty[@]}" \
  --user "$(id -u):$(id -g)" --group-add "$(stat -c %g "$socket")" \
  --network host \
  -v "$socket:$socket" -v "$source_dir:/workspace" -v "$repo_dir:$repo_dir:ro" \
  -w /workspace \
  -e "DRONE_SIM_ROOT=$repo_dir" -e COMPOSE_PROJECT_NAME -e COMPOSE_PROFILES \
  -e LD_LIBRARY_PATH=/workspace/build-docker/bin:/workspace/build-docker/lib:/opt/sen/bin:/opt/sen/lib \
  -e SEN_ETHER_ALLOW_VIRTUAL_INTERFACES=true \
  --entrypoint /bin/bash "$image" "${args[@]}"
