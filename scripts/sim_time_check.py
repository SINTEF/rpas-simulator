#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Measure the simulation clock against a running stack, over REST like scenario.py.

  scripts/sim_time_check.py [seconds]      # default 20; samples every 0.1 s of wall time

Reads sim.bus/world (simTime, timeScale, paused), every truth_drone<ID>.state, every
swarm.bus/drone<ID>.telemetry and heartbeat, every ground asset's position and stateTime, and
ground_station.heartbeat, then prints per situation:
  rate      simTime advance / (wall time x timeScale), per stretch of constant timeScale and pause
  stamp     max |stateTime - simTime| of each object (simTime read just before it, same sample)
  flown     distance flown / (speed x delta stateTime) over the whole run (chords: < 1 on a curve),
            and the clock's lead over the motion in sim seconds: delta stateTime minus the time
            flown, which for a drone is its battery drain x 1800 s (the airframe's endurance; exact,
            needs an armed drone) and for a ground asset distance / speed
  stamp error  (drones) max - min over the run of that lead: how far a stamp strays from the
            motion it labels; at most one airframe step (20 ms) x timeScale expected
  jump      largest single-sample step in position (m) and in stateTime (s)
  spread    max stateTime difference between drones within one sample
  beat      heartbeat increments per wall second
Same one untyped interest per bus as scenario.py (the workaround for the SEN kernel bug at
05da288e, ARCHITECTURE.md section 9). A read that times out (a paused world holds the REST
gateway) only skips that sample.
"""
import math
import sys
import time

from scenario import api, connect

R_EARTH = 6371000.0


def get(interest, name, prop):
    return api("GET", f"/api/interests/{interest}/objects/{name}/properties/{prop}")


def distance(a, b):
    """Metres between two GeoPositions, flat-earth (samples are metres apart), altitude included."""
    north = math.radians(b["latitude"] - a["latitude"]) * R_EARTH
    east = math.radians(b["longitude"] - a["longitude"]) * R_EARTH * math.cos(math.radians(a["latitude"]))
    return math.sqrt(north * north + east * east + (b["altitude"] - a["altitude"]) ** 2)


def objects(interest):
    return {o["name"]: o["className"] for o in api("GET", f"/api/interests/{interest}/objects")}


def sample(movers, beats):
    """One sample: wall time, the world, then each mover (simTime re-read before each, for the stamp gap)."""
    s = {"wall": time.monotonic(), "world": {p: get("sim", "world", p) for p in ("simTime", "timeScale", "paused")}}
    for key, (interest, name, prop) in movers.items():
        simTime = get("sim", "world", "simTime")
        if prop == "state" or prop == "telemetry":
            v = get(interest, name, prop)
            s[key] = (simTime, v["stateTime"], v["position"], v["groundSpeed"], v["battery"])
        else:
            s[key] = (simTime, get(interest, name, "stateTime"), get(interest, name, "position"), None, None)
    s["beats"] = {key: get(interest, name, "heartbeat") for key, (interest, name) in beats.items()}
    return s


def report(samples, speeds):
    print(f"{len(samples)} samples over {samples[-1]['wall'] - samples[0]['wall']:.1f} s wall")
    # rate, per stretch of constant (timeScale, paused); the first pair of a stretch straddles the change
    stretch = [samples[0]]
    for s in samples[1:] + [None]:
        w = stretch[0]["world"]
        if s is None or (s["world"]["timeScale"], s["world"]["paused"]) != (w["timeScale"], w["paused"]):
            a, b = stretch[1] if len(stretch) > 2 else stretch[0], stretch[-1]
            wall = b["wall"] - a["wall"]
            advance = b["world"]["simTime"] - a["world"]["simTime"]
            want = 0.0 if w["paused"] else wall * w["timeScale"]
            ratio = f"{advance / want:.4f}" if want else "-"
            print(f"  rate   scale {w['timeScale']:g}{' paused' if w['paused'] else ''}: simTime +{advance:.2f} s"
                  f" in {wall:.1f} s wall, ratio {ratio}")
            stretch = [s]
        else:
            stretch.append(s)
    for key in speeds:
        rows = [s[key] for s in samples]
        gap = max(abs(r[1] - r[0]) for r in rows)
        flown = expected = jump = stamp_jump = 0.0
        for (s0, t0, p0, v0, _), (s1, t1, p1, v1, _) in zip(rows, rows[1:]):
            d = distance(p0, p1)
            speed = speeds[key] if v0 is None else (v0 + v1) / 2
            flown += d
            expected += speed * (t1 - t0)
            jump = max(jump, d)
            stamp_jump = max(stamp_jump, t1 - t0)
        mean_speed = expected / (rows[-1][1] - rows[0][1]) if rows[-1][1] > rows[0][1] else 0.0
        lead = (expected - flown) / mean_speed if mean_speed > 0 else 0.0
        error = ""
        if rows[0][4] is not None:  # a drone: the battery drains by exactly the flown dt / 1800 s (exact on a curve)
            leads = [(r[1] - rows[0][1]) - (rows[0][4] - r[4]) * 1800.0 for r in rows]
            lead = leads[-1]
            error = f" | stamp error {max(leads) - min(leads):6.2f} s"
            if rows[0][4] == rows[-1][4]:  # not draining (disarmed, crashed, paused): no motion clock
                lead, error = float("nan"), " | stamp error      - (battery not draining)"
        ratio = f"{flown / expected:.3f}" if expected > 0 else "-"
        print(f"  {key:16s} stamp gap {gap:7.2f} s | flown {flown:8.0f} m ratio {ratio} lead {lead:7.2f} s |"
              f" jump {jump:6.0f} m, {stamp_jump:6.2f} s{error}")
    truths = [k for k in speeds if k.startswith("truth_drone")]
    if len(truths) > 1:
        spread = max(max(s[k][1] for k in truths) - min(s[k][1] for k in truths) for s in samples)
        print(f"  spread max stateTime difference across {len(truths)} drones in one sample: {spread:.2f} s")
    wall = samples[-1]["wall"] - samples[0]["wall"]
    for key in samples[0]["beats"]:
        print(f"  beat   {key}: {(samples[-1]['beats'][key] - samples[0]['beats'][key]) / wall:.1f} / s")


def main():
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 20.0
    connect()
    time.sleep(1)  # objects are discovered asynchronously
    sim, swarm = objects("sim"), objects("swarm")
    movers, speeds = {}, {}
    for name, cls in sorted(sim.items()):
        if cls.endswith("DroneTruth"):
            movers[name] = ("sim", name, "state")
            speeds[name] = None
        elif cls.endswith("GroundAsset"):
            movers[name] = ("sim", name, "position")
            speeds[name] = get("sim", name, "speed")
    for name, cls in sorted(swarm.items()):
        if cls.endswith("DroneLink"):
            movers[name + ".telemetry"] = ("swarm", name, "telemetry")
            speeds[name + ".telemetry"] = None
    beats = {n: ("swarm", n) for n, cls in sorted(swarm.items()) if cls.endswith(("DroneLink", "GroundStation"))}

    samples = []
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        started = time.monotonic()
        try:
            samples.append(sample(movers, beats))
        except OSError:
            pass  # a stalled world holds the gateway: skip
        time.sleep(max(0.0, 0.1 - (time.monotonic() - started)))
    if len(samples) < 2:
        sys.exit("fewer than two samples")
    report(samples, speeds)


if __name__ == "__main__":
    main()
