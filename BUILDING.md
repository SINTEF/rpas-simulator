# Building drone_sim

The normal way to run drone_sim is Docker (`scripts/up.sh`, see [`README.md`](README.md)). This
file covers everything else: native builds, the SEN development container and build details.

## SEN version

drone_sim is pinned to SEN upstream `main` at commit `05da288e8ed4f401cabdb9419fe8c1a414892f37`
(2026-09-14). The Docker image `drone_sim/sen-base` contains it.

A native build needs SEN installed at that commit. Either build it from
github.com/airbus/sen, or copy `/opt/sen` out of `drone_sim/sen-base`. Below, `$SEN_INSTALL` is
that install.

## Native build

```bash
cmake -S . -B build -Dsen_DIR=$SEN_INSTALL/cmake/sen -DCMAKE_BUILD_TYPE=Release
cmake --build build -j2        # a bare -j runs WSL2 out of memory
ctest --test-dir build         # unit tests (built only where gtest is installed)
scripts/run_native.sh 2        # world + ground_station + 2 drones; Ctrl-C stops all
scripts/smoke.sh               # REST check: arm, takeoff, fly a route, land
```

Notes on `run_native.sh`:

- It reads `SEN_INSTALL` (default `$HOME/SEN/install`) and sets `LD_LIBRARY_PATH` to `build/lib`
  and `$SEN_INSTALL/{bin,lib}`.
- It uses the same YAMLs as the compose stack. Every drone runs `config/drone.yaml`.
- It sets `SEN_ETHER_DISCOVERY_PORT=47120`. This keeps our multicast discovery apart from other
  SEN users on the LAN. Change the value if it collides.
- `RECORD=true` records `sim.bus` and `swarm.bus` from the world process into `recordings/`.
- Partner components are Docker-only and do not run natively.

After a pull that removes a package, delete `build/`.

`scripts/watch_build.sh` rebuilds on every CMake, C++ or `.stl` change. It needs `inotify-tools`.

## SEN development container

`scripts/run_devmachine.sh` opens a Bash shell in a container with GCC 12, CMake, the Docker CLI,
`check_health` and the installed SEN framework and code generator. It builds `drone_sim/sen-dev`
on top of `drone_sim/sen-base:05da288e`, so build the base once first (any `scripts/up.sh` does
that).

```bash
scripts/run_devmachine.sh                              # mounts the current directory
run_devmachine.sh /absolute/path/to/another-sen-app    # or any SEN source tree

# Inside the container:
cmake -S . -B build-docker -DCMAKE_BUILD_TYPE=Release
cmake --build build-docker -j2
sen run config.yaml             # your application's configuration
check_health                    # simulator health
check_health 3                  # also require three running drones
```

- The source is writable at `/workspace`, and the container runs with your UID/GID.
- `build-docker/` keeps container builds apart from native builds and survives shell exit.
- Exiting removes the container: packages installed only inside it are lost.
- `SEN_BASE` overrides the base image, `SEN_DEV_IMAGE` the development image tag.
- For `check_health`, the launcher mounts the host Docker socket (this grants control of the host
  Docker Engine) and uses host networking. Docker Desktop needs host networking enabled.
- Repositories with extra dependencies need a derived image. Symlink targets outside the mounted
  source are not mounted.

## Docker build details

- `scripts/up.sh` builds images one at a time with `JOBS=16`. On a default WSL2 VM, use `JOBS=1`.
- It needs Docker with BuildKit/buildx. Outside Docker Desktop and docker-ce, install the buildx plugin.
- The sim's CMake build tree lives in a BuildKit cache mount (`docker/Dockerfile`), so an image
  build is an incremental `make`. `docker builder prune` drops it, and the next build is cold again.
- `patches/sen/` holds one optional ether patch. It only matters for the TCP-hub fallback
  ([`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)).

### Build times

Measured 2026-09-27 on WSL2 (8 cores, 7.7 GB RAM), `JOBS=1`, `docker compose build world` unless
noted. The first two rows follow a `docker builder prune` (Conan cache included).

| Change | Time | What runs |
|---|---|---|
| none (cold): `drone_sim/sen-base` | 58 min | apt + pip 2 min, Conan builds 19 third-party packages 13 min, SEN 44 min; peak +2.4 GB RAM, no swap |
| none (cold): `drone_sim/sim` | 35 min | every package |
| cold total, `scripts/up.sh 2` | 93 min | both of the above, `drone_sim/web`, stack up |
| a Markdown file | 1 s | nothing (`scripts/up.sh 2` on a running stack: 4 s) |
| a YAML in `config/` | 1 s | the last `COPY` |
| one `.cpp` (in a package removed since) | 56 s | that file, one link |
| one `.stl` (`interfaces/.../swarm_bus/waypoint_navigator.stl`) | 4 min | its codegen, the 7 packages that include it, relinks |

## WP4000/WP5000 partner interfaces

The ERA2 WP4000/WP5000 interface repositories (`.stl` files, targets `wp4000` and `wp5000`) are
closed. If you have them, put them in `external/wp4000/` and `external/wp5000/` so that each has
a `CMakeLists.txt`. They are git-ignored and never committed.

- The build works without them. Configure prints one line per missing repository.
- Nothing of ours uses a partner type at runtime.
- Only native builds use them: `.dockerignore` keeps `external/` out of the `drone_sim/sim` image.
- Tested with WP4000 @337beb9ab2e0 and WP5000 @2cd68ecf6cc3. An older WP4000 still imports
  `fom/rpr`, which is gone (`ARCHITECTURE.md` §11), and configure stops with an error naming it.
