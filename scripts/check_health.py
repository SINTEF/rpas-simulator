#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Inspect simulator availability without sending flight commands.

Checks the Compose services, drone compose project containers, the drone_sim network and the
HTTP endpoints of the web UI and the world REST API.

Exit codes: 0 = passed (possibly with warnings), 1 = unhealthy,
2 = check unavailable (missing tool, bad repository, Docker unreachable).
"""
import argparse
import collections
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

REQUIRED_SERVICES = {"world", "ground_station", "web"}
HTTP_PORTS = {"web": 8000, "world": 8080}  # service -> container port
DRONE_LABEL = "drone_sim.drone"
SERVICE_LABEL = "com.docker.compose.service"

counts = collections.Counter()  # number of reports per level


def parse_args():
    """Parse the command line and return the arguments."""
    source_root = Path(__file__).resolve().parent.parent
    if (source_root / "docker-compose.yml").is_file():
        default_root = str(source_root)
    else:
        default_root = os.getcwd()
    parser = argparse.ArgumentParser(
        description="Check simulator containers, drone compose projects, networks, UI and REST authentication.",
        epilog="Exit codes: 0 = passed (possibly warnings), 1 = unhealthy, 2 = check unavailable. "
               "HTTP probes require access to the Docker host's published ports.")
    parser.add_argument("expected_drones", nargs="?", type=int,
                        help="expected number of running drones")
    parser.add_argument("--root", default=os.environ.get("DRONE_SIM_ROOT") or default_root,
                        help="simulator repository (default: DRONE_SIM_ROOT, source checkout, "
                             "or current directory)")
    args = parser.parse_args()
    if args.expected_drones is not None and args.expected_drones < 0:
        parser.error("expected_drones must be nonnegative")
    return args


def fail_unavailable(message):
    """Print a failure and exit with code 2 (check unavailable)."""
    print(f"FAIL  {message}", flush=True)
    sys.exit(2)


def report(level, message):
    """Print a PASS/WARN/FAIL line and count it."""
    counts[level] += 1
    print(f"{level:4}  {message}", flush=True)


def docker(*cmd):
    """Run a docker command and return its stripped stdout.

    The Docker daemon is the only source of container state, services, drone
    drone compose projects, networks and published ports, so this is needed on the host and in
    the devmachine alike.
    
    In the devmachine, the CLI talks to the host daemon through the bind-mounted
    /var/run/docker.sock and inspects the host's stack. The Engine API over the
    socket could replace the CLI, but it cannot parse the Compose file for 
    `docker compose config --services`.

    Raises RuntimeError if docker cannot run, times out or exits non-zero.
    """
    try:
        result = subprocess.run(["docker", *cmd], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(str(exc)) from exc
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result.stdout.strip()


def probe(label, url, auth=False):
    """Fetch url with curl and report PASS on a 2xx status, FAIL otherwise.

    With auth=True, POST a fresh client id as JSON, as the REST /api/auth expects.
    """
    cmd = ["curl", "--silent", "--show-error", "--noproxy", "*",
           "--connect-timeout", "3", "--max-time", "8",
           "--output", "/dev/null", "--write-out", "%{http_code}"]
    if auth:
        body = json.dumps({"id": "health-" + uuid.uuid4().hex})
        cmd += ["-H", "Content-Type: application/json", "--data", body]
    try:
        result = subprocess.run([*cmd, url], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired) as exc:
        report("FAIL", f"{label}: {url} ({exc})")
        return
    ok = result.returncode == 0 and result.stdout.startswith("2")
    detail = result.stderr.strip() or f"HTTP {result.stdout}"
    report("PASS" if ok else "FAIL", f"{label}: {url} ({detail})")


def published_url(container, port):
    """Return the host URL for a container's published TCP port, or None.

    Prefers an IPv4 binding. Wildcard addresses map to the matching loopback.
    """
    ports = container.get("NetworkSettings", {}).get("Ports") or {}
    bindings = ports.get(f"{port}/tcp") or []
    if not bindings:
        return None
    binding = next((b for b in bindings if ":" not in b["HostIp"]), bindings[0])
    host = binding["HostIp"]
    if host in ("", "0.0.0.0"):
        host = "127.0.0.1"
    elif host == "::":
        host = "::1"
    if ":" in host:
        host = f"[{host}]"  # IPv6 literal
    return f"http://{host}:{binding['HostPort']}"


def labels_of(container):
    """Return a container's labels (Docker gives null when there are none)."""
    return container["Config"].get("Labels") or {}


def load_stack():
    """Return (compose service names, compose container ids, inspected containers).

    Containers include both the Compose stack and the drone compose project containers.
    """
    services = docker("compose", "config", "--services").splitlines()
    compose_ids = docker("compose", "ps", "--all", "--quiet").splitlines()
    drone_ids = docker("ps", "--all", "--quiet", "--filter", f"label={DRONE_LABEL}").splitlines()
    ids = list(dict.fromkeys(compose_ids + drone_ids))  # dedupe, keep order
    containers = json.loads(docker("inspect", *ids)) if ids else []
    return services, compose_ids, containers


def check_services(services, compose_ids, containers):
    """Report missing Compose services and return {service: [containers]}."""
    by_service = collections.defaultdict(list)
    for container in containers:
        # Short or full ids may be returned; inspect always gives the full id.
        if any(container["Id"].startswith(i) for i in compose_ids):
            by_service[labels_of(container).get(SERVICE_LABEL)].append(container)
    for service in sorted(set(services) | REQUIRED_SERVICES):
        if service not in by_service:
            report("FAIL", f"Missing service: {service}")
    return by_service


def check_container(container):
    """Report a container's state, health, restarts and drone_sim network attachment."""
    name = container["Name"].lstrip("/")
    state = container["State"]
    status = state["Status"]
    health = (state.get("Health") or {}).get("Status", "not configured")
    restarts = container["RestartCount"]

    ok = status == "running" and health in ("healthy", "not configured")
    report("PASS" if ok else "FAIL", f"{name}: {status}; health={health}; restarts={restarts}")
    if state.get("Error"):
        report("FAIL", f"  Docker error: {state['Error']}")
    if state.get("OOMKilled"):
        report("FAIL", "  Killed by out-of-memory condition")
    if status == "exited":
        print(f"      Exit code: {state['ExitCode']}; finished: {state.get('FinishedAt')}")
    if restarts:
        report("WARN", f"  {name} has restarted; inspect its logs if unexpected")

    # Containers sharing another container's network namespace have no own networks.
    shares_network = container["HostConfig"].get("NetworkMode", "").startswith("container:")
    networks = container.get("NetworkSettings", {}).get("Networks") or {}
    if not shares_network and "drone_sim" not in networks:
        report("FAIL", f"  {name} is not attached to the drone_sim network")
    if not ok:
        print(f"      Logs: docker logs --tail=50 {name}")


def check_drones(containers, expected):
    """Report drone compose projects without a core container and compare the running count."""
    pods = set()
    cores = []
    for container in containers:
        labels = labels_of(container)
        pod = labels.get(DRONE_LABEL)
        if pod is None:
            continue
        pods.add(pod)
        if labels.get(SERVICE_LABEL) == "core":
            cores.append(container)

    running = sum(c["State"]["Status"] == "running" for c in cores)
    print(f"\nDrones: {running}/{len(cores)} core containers running; {len(pods)} compose project(s)")
    for pod in sorted(pods - {labels_of(c)[DRONE_LABEL] for c in cores}):
        report("FAIL", f"Drone compose project drone{pod} has no core container")
    if expected is not None:
        report("PASS" if running == expected else "FAIL",
               f"Expected {expected} running drone(s), found {running}")
    elif not cores:
        report("WARN", "No drone cores found; pass EXPECTED_DRONES to require a specific count")


def check_http(by_service):
    """Probe the web UI, its API proxy and the world REST API on published ports."""
    print()
    for service, port in HTTP_PORTS.items():
        for container in by_service.get(service, []):
            url = published_url(container, port)
            if url is None:
                report("FAIL", f"{service}: container port {port} is not published")
            elif service == "web":
                print(f"Browser URL: {url}/", flush=True)
                probe("Browser UI", url + "/")
                probe("Web-to-world API proxy", url + "/api/auth", auth=True)
            else:
                probe("World REST API", url + "/api/auth", auth=True)


def main():
    """Run all checks and exit with the code described in the module docstring."""
    args = parse_args()
    for tool in ("docker", "curl"):
        if shutil.which(tool) is None:
            fail_unavailable(f"Missing dependency: {tool}")
    try:
        os.chdir(args.root)
    except OSError as exc:
        fail_unavailable(f"Cannot access simulator repository: {exc}")
    # Compose interpolates PWD; a dev shell may have started in another source checkout.
    os.environ["PWD"] = os.getcwd()

    print("Simulator health (container and HTTP checks)", flush=True)
    try:
        services, compose_ids, containers = load_stack()
    except (RuntimeError, ValueError) as exc:
        fail_unavailable(f"Cannot inspect Docker stack: {exc}")

    by_service = check_services(services, compose_ids, containers)
    for container in sorted(containers, key=lambda c: c["Name"]):
        check_container(container)
    check_drones(containers, args.expected_drones)
    check_http(by_service)

    print(f"\n{counts['FAIL']} failure(s), {counts['WARN']} warning(s).")
    print("Checks cover containers and HTTP availability, not bus discovery or flight behaviour.")
    sys.exit(1 if counts["FAIL"] else 0)


if __name__ == "__main__":
    main()
