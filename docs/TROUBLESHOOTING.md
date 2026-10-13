# Troubleshooting

## Health check

Run `scripts/check_health.sh [EXPECTED_DRONES]` on the host, or `check_health` inside the
development container ([`BUILDING.md`](../BUILDING.md)). It reports container state, health,
restarts, networks and whether the UI and API can be reached. It does not check bus discovery or
flight behaviour. Exit status: 0 pass, 1 fail, 2 the check could not run.

## How the stack is laid out

- `docker-compose.yml` holds the fixed services: `world`, `ground_station`, `web`.
- Each drone is its own compose project from `docker/drone.compose.yml` (project `drone<ID>`).
  It has the `core` container `drone<ID>` plus any on-board partner containers, all on
  `drone<ID>.bus`.
- Containers can start in any order. A restarted drone (`docker restart drone2`) rejoins on its
  own, because discovery is SEN's default multicast on the compose network.
- Every drone core container needs a unique hostname (`drone<ID>`): SEN identifies participants by it.
- The `web` container runs `docker compose` through the Docker socket for Spawn/Remove, so keep
  port 8000 on localhost.

## Port clashes

The UI is served by `web` on host port **8000**. `world` serves the REST API on host port **8080**.
To run alongside another local server:

```bash
WEB_PORT=8001 REST_PORT=8081 scripts/up.sh 2
SEN_REST=http://localhost:8081 scripts/smoke.sh
```

Then open `http://localhost:8001`. These variables change only the host ports; the web container
still proxies to `world:8080`. Put them in a local `.env` file to keep the same ports across
Compose commands.

`SEN_ETHER_DISCOVERY_PORT` (60544 in compose, 47120 native) keeps our multicast group away from
other SEN users on the LAN.

## A container fails to start

Check the container's saved error as well as its logs. A port-publishing failure happens before
the application starts, so `docker compose logs web` may be empty.

```bash
docker compose ps -a
docker inspect "$(docker compose ps -aq web)" --format '{{.State.Error}}'
ss -ltnp '( sport = :8000 or sport = :8080 )'
docker compose logs --tail=50 world
docker inspect "$(docker compose ps -aq world)" --format '{{json .NetworkSettings.Networks}}'
```

## `world` cannot join the multicast group

If `world` logs `could not join multicast group` / `No such device` and its network map is empty
(`{}`), the container has lost its network attachment. Starting the same container again does not
fix it. Recreate it so Compose attaches the `drone_sim` network again:

```bash
docker compose up -d --no-deps --force-recreate world
```

If the network attachment is there, check multicast support for your platform (below).

## Platforms

- **WSL2** (the development host, Ubuntu 22.04 with docker-ce inside WSL): works. Use `JOBS=1`.
  Docker Desktop for Windows should behave the same; it has not been tried.
- **Native Linux**: works, nothing to add.
- **macOS Docker Desktop**: untested. Multicast between containers is expected to work on the
  compose bridge network. If drones never show up on `swarm.bus`, switch to the SEN TCP-discovery hub:
  1. uncomment the hub port on `world` in `docker-compose.yml`;
  2. in `config/ether.yaml` (every process includes it), set `busConfig.multicastDisabled` and
     `discovery: TcpDiscovery` with `hubAddress: {host: world, port: 64222}`;
  3. apply `patches/sen/0003` to the base image; that mode needs it.
- **Line endings**: `.gitattributes` keeps LF in every checkout, so a Windows clone runs the
  scripts and YAMLs unchanged inside the Linux containers.
