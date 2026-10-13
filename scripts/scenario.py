#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Run a scenario against the compose stack over REST, exactly as the UI or smoke.sh would
(not inside the world process: a second swarm.bus interest there would hit the SEN freeze, ARCHITECTURE.md §9).

  scripts/scenario.py <name>            # restart the stack, spawn its drones,
                                        # send its steps, then wait for its expected end state
  scripts/scenario.py <name> --check    # only the end state, against whatever is running
  scripts/scenario.py <name> --no-restart

scenarios/<name>.yaml is data only:
  drones: {1: null, 2: [59.914, 10.76]}   # id -> start [lat, lon], null = default (east of origin)
  steps:                              # in order
    - [all, arm]                      # [target, method, args...]; target all (= every drone), drone<ID> or an object
    - wait: 5                         # seconds
    - wait_for: {timeout: 60, drone1: {telemetry.position.altitude: ">80"}}
    - run: [docker, compose, pause, ground_station]   # a command, from the repo root
    - refused: [drone1, arm]                          # a command that must be refused (NACK) ...
      message: crashed                                # ... with this text in its message (optional)
  expect: {timeout: 300, waypoint_navigator_drone1: {status: arrived}}
  cleanup:                            # commands run at the end whatever happened (pass, fail, Ctrl-C);
                                      # may repeat a step's command, a failure here is only reported
    - [docker, compose, unpause, ground_station]
    - [world, setTimeScale, 1.0]      # or an invoke, as a step: first element world, drone<ID> or waypoint_navigator_drone<ID>

An object is a swarm.bus name (drone1, waypoint_navigator_drone1, ground_station),
`world` (sim.bus), or `drone<ID>.bus/<name>` for a drone bus object (drone1.bus/sensor), read-only by
convention: the drone bus is display and checks only, commands go over swarm.bus.
A step [target, method, args...] invokes the target's own object directly: all = every drone<ID>;
a route is [waypoint_navigator_drone<ID>, setRoute, route, speed] (or cancel).
A condition is object -> {property[.field or list index...]: value}; value is a number, an enum member (by the last
field's name: mode, status (navigator))
or ">x" / "<x".
Same REST calls as the UI and smoke.sh, one untyped interest per bus: a workaround for the kernel
bug at SEN 05da288e (ARCHITECTURE.md §9 has the full description), to be removed when upstream fixes it.
"""
import json
import os
import random
import re
import subprocess
import sys
import time
import urllib.request

import yaml

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
REST = os.environ.get("SEN_REST", "http://localhost:8080")
ENUMS = {  # enum property/field name -> member names in declaration order (same tables as viz/app/model/enums.js)
    "mode": ["disarmed", "armed", "takeoff", "hold", "goingTo", "land", "crashed"],
    "status": ["idle", "navigating", "arrived"],  # WaypointNavigator.status
}

TOKEN = {}  # the auth cookie is `Secure`, so plain-http clients send the token as a Bearer header (as sen_client.js)


def api(method, path, body=None):
    req = urllib.request.Request(REST + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Accept": "application/json", **TOKEN})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read() or "null")


def connect():
    deadline = time.time() + 60
    while True:
        try:
            token = api("POST", "/api/auth", {"id": "scenario-%06d" % random.randrange(10**6)})["token"]  # fresh id: see smoke.sh
            TOKEN["Authorization"] = "Bearer " + token
            break
        except OSError:
            if time.time() > deadline:
                sys.exit("world REST not reachable at " + REST)
            time.sleep(1)
    api("POST", "/api/interests", {"name": "swarm", "query": "SELECT * FROM swarm.bus"})
    api("POST", "/api/interests", {"name": "sim", "query": "SELECT * FROM sim.bus"})


def split(obj):
    """(interest, object name) of a scenario object; a drone bus gets its interest on first use."""
    if obj == "world":
        return "sim", obj
    if ".bus/" in obj:
        bus, name = obj.split("/", 1)
        interest = "d" + bus[len("drone"):-len(".bus")]
        if interest not in DRONE_BUSES:
            api("POST", "/api/interests", {"name": interest, "query": f"SELECT * FROM {bus}"})
            DRONE_BUSES.add(interest)
            time.sleep(1)  # its objects are discovered asynchronously
        return interest, name
    return "swarm", obj


DRONE_BUSES = set()


def names(interest):
    try:
        return {o["name"] for o in api("GET", f"/api/interests/{interest}/objects")}
    except OSError:
        return set()


def prop(obj, path):
    first, *rest = path.split(".")
    interest, name = split(obj)
    v = api("GET", f"/api/interests/{interest}/objects/{name}/properties/{first}")
    for f in rest:
        v = v[int(f)] if isinstance(v, list) else v[f]  # drones.0.mode: a list index
    return v


def invoke(obj, method, args):
    interest, name = split(obj)
    base = f"/api/interests/{interest}/objects/{name}/methods/{method}/invoke"
    started = api("POST", base, args)
    for _ in range(25):
        time.sleep(0.2)
        res = api("GET", f"{base}/{started['id']}")
        if res.get("status") == "finished":
            ack = json.loads(res["result"]) if isinstance(res.get("result"), str) else res.get("result")
            return ack or {"status": 98, "message": "no ack (null result)"}  # every method returns a CommandAck
    return {"status": 99, "message": "no ack (timeout)"}


def is_invoke(cmd):
    return re.fullmatch(r"world|(waypoint_navigator_)?drone\d+", str(cmd[0])) is not None


def holds(obj, path, want):
    try:
        got = prop(obj, path)
    except (OSError, KeyError, TypeError):
        return False, "unreadable"
    field = path.split(".")[-1]
    if isinstance(want, str) and want[:1] in "<>":
        ok = isinstance(got, (int, float)) and (got > float(want[1:]) if want[0] == ">" else got < float(want[1:]))
    elif isinstance(want, str) and field in ENUMS:
        ok = got == ENUMS[field].index(want)
    elif isinstance(want, list) and isinstance(got, list):
        ok = sorted(map(str, got)) == sorted(map(str, want))  # a set: join order varies
    else:
        ok = got == want
    shown = ENUMS[field][got] if field in ENUMS and isinstance(got, int) and got < len(ENUMS[field]) else got
    return ok, shown


def wait_for(cond, label):
    """Poll until every condition holds at once; print each one's last state. True if all held."""
    cond = dict(cond)
    timeout = cond.pop("timeout", 60)
    deadline = time.time() + timeout
    while True:
        results = [(o, p, w, *holds(o, p, w)) for o, props in cond.items() for p, w in props.items()]
        if all(r[3] for r in results) or time.time() > deadline:
            break
        time.sleep(1)
    for o, p, w, ok, got in results:
        print(f"{'PASS' if ok else 'FAIL'}  {label}: {o}.{p} == {w}" + ("" if ok else f"  — got {got} after {timeout} s"))
    return all(r[3] for r in results)


def restart(sc):
    env = dict(os.environ, DRONE_SIM_ROOT=os.path.abspath(ROOT))  # web spawns drones
    print(f"== restart: drones {list(sc['drones'])}")
    # the base services that exist now (partner services such as geocage too), as serve.py /reset keeps them
    base = subprocess.run(["docker", "compose", "--profile", "*", "ps", "-a", "--services"], cwd=ROOT, env=env, check=True,
                          capture_output=True, text=True).stdout.split()
    subprocess.run([os.path.join(ROOT, "scripts/down.sh")], cwd=ROOT, env=env, check=True, capture_output=True)
    services = sorted(set(base) | {"world", "ground_station", "web"})
    subprocess.run(["docker", "compose", "--profile", "*", "up", "-d", "--no-build", *services], cwd=ROOT, env=env, check=True,
                   capture_output=True)
    for i, position in sc["drones"].items():
        subprocess.run([os.path.join(ROOT, "scripts/spawn_drone.sh"), str(i), *map(str, position or [])], cwd=ROOT, env=env,
                       check=True, capture_output=True)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    name, flags = sys.argv[1], sys.argv[2:]
    with open(os.path.join(ROOT, "scenarios", name + ".yaml")) as f:
        sc = yaml.safe_load(f)
    try:
        run(name, flags, sc)
    finally:
        for cmd in sc.get("cleanup", []):
            if is_invoke(cmd):
                try:
                    if not TOKEN:
                        connect()
                    result = invoke(cmd[0], cmd[1], cmd[2:]).get("message")
                except (OSError, SystemExit) as e:
                    result = e
                print(f"      cleanup: {' '.join(map(str, cmd))} ({result})")
                continue
            done = subprocess.run(cmd, cwd=ROOT, capture_output=True)  # may be a no-op (already undone)
            print(f"      cleanup: {' '.join(cmd)} (exit {done.returncode})")


def run(name, flags, sc):
    drones = ["drone%s" % i for i in sc["drones"]]
    if "--check" not in flags:
        if "--no-restart" not in flags:
            restart(sc)
        connect()
        deadline = time.time() + 60
        while not set(drones + ["ground_station"]) <= names("swarm") or "world" not in names("sim"):
            if time.time() > deadline:
                sys.exit(f"objects missing on the buses: have {sorted(names('swarm'))}")
            time.sleep(1)
        print(f"== {name}: {len(drones)} drone(s) up, sending steps")
        for step in sc.get("steps", []):
            if isinstance(step, dict) and "wait" in step:
                time.sleep(step["wait"])
            elif isinstance(step, dict) and "wait_for" in step:
                if not wait_for(step["wait_for"], "wait_for"):
                    sys.exit(1)
            elif isinstance(step, dict) and "run" in step:
                done = subprocess.run(step["run"], cwd=ROOT)
                print(f"{'ok  ' if done.returncode == 0 else 'FAIL'}  run: {' '.join(step['run'])}")
                if done.returncode:
                    sys.exit(1)
            elif isinstance(step, dict) and "refused" in step:
                obj, method, *args = step["refused"]
                ack = invoke(obj, method, args)
                ok = ack.get("status") not in (0, 98, 99) and step.get("message", "") in (ack.get("message") or "")  # 98/99: no ack
                print(f"{'PASS' if ok else 'FAIL'}  refused: {obj}.{method}: {ack.get('message')}")
                if not ok:
                    sys.exit(1)
            else:
                target, method, *args = step
                for obj in (drones if target == "all" else [target]):
                    ack = invoke(obj, method, args)
                    print(f"{'ok  ' if ack.get('status') == 0 else 'NACK'}  {obj}.{method}: {ack.get('message')}")
    else:
        connect()
    ok = wait_for(sc.get("expect", {}), name)
    print("ALL PASS" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
