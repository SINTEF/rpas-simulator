#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

# The release file: drone_sim/sim of this checkout, tagged with its contract version and saved as one
# file a partner loads instead of building drone_sim/sen-base and drone_sim/sim (~90 min):
#   scripts/release.sh     # -> dist/drone_sim-sim-<VERSION>.tar.gz and its sha256
# The partner then: docker load -i drone_sim-sim-<VERSION>.tar.gz, builds FROM drone_sim/sim:<VERSION>
# (ARCHITECTURE.md §4.4), and runs the stack with scripts/up.sh from the same version of this repo.
# How the file reaches partners is not decided (ARCHITECTURE.md §9). dist/ is git-ignored.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose build world   # drone_sim/sim as this checkout builds it; a no-op when nothing changed
# The version the image carries, not the checkout's file: the tag and the name must say what is inside.
VERSION=$(docker run --rm --entrypoint cat drone_sim/sim /opt/drone_sim/VERSION)
docker tag drone_sim/sim "drone_sim/sim:$VERSION"
mkdir -p dist
FILE=dist/drone_sim-sim-$VERSION.tar.gz
docker save "drone_sim/sim:$VERSION" | gzip > "$FILE.partial"   # pipefail: a failed save never gets the final name
mv "$FILE.partial" "$FILE"
ls -lh "$FILE"
sha256sum "$FILE"
