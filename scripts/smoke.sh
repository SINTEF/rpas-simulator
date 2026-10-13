#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
# This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
# If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

# REST smoke test against a running stack (native or compose): world REST on :8080.
#   scripts/smoke.sh [N] [SCENARIO]   # default N=2 drones; SEN_REST overrides http://localhost:8080
# With SCENARIO (run by scripts/scenario.py first), steps 7-8 (smoke's own test flight) are replaced by
# `scenario.py SCENARIO --check`: that scenario's expected end state.
# Checks: the naming guard (scripts/check_names.py); auth; on swarm.bus drone1..droneN,
# waypoint_navigator_drone1..N, example_drone1..N, ground_station and fleet_status, example_drone1 position and setMessage -> message, drone<ID> and ground_station heartbeats advancing; the airframe
# envelope readable over the air; drone1.bus and drone2.bus each holding only their own drone; sim.bus/world simTime advancing; truth_drone<ID> on the sim bus; a two-waypoint
# route sent BEFORE takeoff, then arm + takeoff, every command a direct call on the drone's own object
# (waypoint_navigator_drone1 / drone1), drone1's altitude rising and the route flown to
# status == arrived, then land; fleet_status.aliveCount == N.
# Re-runnable on a stack it has already flown: a fresh client id every run (SEN's REST interests are
# per client id, and re-using one kills the other session), and if drone1 is already airborne the
# arm/takeoff is skipped and only the altitude is checked.
# One untyped interest per bus, the same queries as the viz: a workaround for the kernel bug at
# SEN 05da288e (two different interests matching the same remote object freeze it; ARCHITECTURE.md
# §9 has the full description), to be removed when upstream fixes it.
set -u
N=${1:-2}
SCEN=${2:-}
REST="${SEN_REST:-http://localhost:8080}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
JAR="$TMP/cookies"

FAILURES=0
pass() { echo "PASS  $1${2:+  — $2}"; }
fail() { echo "FAIL  $1${2:+  — $2}"; FAILURES=$((FAILURES + 1)); }

# api METHOD PATH [JSON_BODY] -> body in $BODY, HTTP status in $CODE
api() {
  local out
  out=$(curl -sS -o - -w $'\n%{http_code}' -X "$1" -b "$JAR" -c "$JAR" \
        -H 'Content-Type: application/json' -H 'Accept: application/json' \
        ${3:+-d "$3"} "$REST$2" 2>"$TMP/curl_err") || { BODY=$(cat "$TMP/curl_err"); CODE=000; return 1; }
  CODE=${out##*$'\n'}
  BODY=${out%$'\n'*}
}

# jsonq JSON PYTHON_EXPR — evaluate an expression against parsed JSON bound to `d`
jsonq() {
  python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(eval(sys.argv[2]))' "$1" "$2" 2>/dev/null
}

# wait_ok DESCRIPTION SECONDS CHECK_FN — poll CHECK_FN until it returns 0
wait_ok() {
  local desc=$1 deadline=$((SECONDS + $2)) fn=$3
  while ((SECONDS < deadline)); do
    if "$fn"; then pass "$desc"; return 0; fi
    sleep 0.5
  done
  fail "$desc" "timeout after $2 s"
  return 1
}

object_count() { # INTEREST -> count on stdout, or -1
  api GET "/api/interests/$1/objects" || { echo -1; return; }
  jsonq "$BODY" 'len(d)' || echo -1
}
object_names() { # INTEREST [CLASS] -> space-separated sorted names (optionally only of CLASS, e.g. DroneTruth)
  api GET "/api/interests/$1/objects" || return 1
  jsonq "$BODY" "\" \".join(sorted(o['name'] for o in d if not '${2:-}' or o['className'] == '${2:-}'))"
}
prop() { # INTEREST OBJECT PROPERTY -> raw JSON value in $BODY
  api GET "/api/interests/$1/objects/$2/properties/$3"
}
invoke() { # INTEREST OBJECT METHOD ARGS_JSON
  api POST "/api/interests/$1/objects/$2/methods/$3/invoke" "$4"
}
interest() { # NAME QUERY
  api POST /api/interests "{\"name\": \"$1\", \"query\": \"$2\"}"
  [[ $CODE == 2* ]] && pass "interest $1" "$2" || fail "interest $1" "HTTP $CODE: $BODY"
}
# advances INTEREST OBJECT PROPERTY — read twice 1 s apart, assert the value increased
advances() {
  local a b
  prop "$1" "$2" "$3"; [[ $CODE == 2* ]] || { fail "$2.$3 advances" "HTTP $CODE: $BODY"; return; }
  a=$(jsonq "$BODY" 'd')
  sleep 1
  prop "$1" "$2" "$3"; [[ $CODE == 2* ]] || { fail "$2.$3 advances" "HTTP $CODE: $BODY"; return; }
  b=$(jsonq "$BODY" 'd')
  [[ $(python3 -c "print($b > $a)" 2>/dev/null) == True ]] \
    && pass "$2.$3 advances" "$a -> $b" || fail "$2.$3 advances" "'$a' -> '$b'"
}

echo "== smoke: $REST  N=$N =="

# 0. naming guard: no short form in our .stl / YAML / compose names
"$(dirname "$0")/check_names.py" | tail -1 | grep -q ': ok' && pass "check_names" || fail "check_names" "run scripts/check_names.py"

# 1. auth (cookie session — interests are per client id, so every run needs its own)
CLIENT_ID="smoke-$$-$(date +%s)"
api POST /api/auth "{\"id\": \"$CLIENT_ID\"}"
[[ $CODE == 2* ]] && pass "auth" || { fail "auth" "HTTP $CODE: $BODY"; echo "aborting — is the world process running?"; exit 1; }

# 2. swarm bus: per drone its vehicle face and the nodes others call (ARCHITECTURE.md section 3), + ground station
interest swarm "SELECT * FROM swarm.bus"
PER_DRONE="drone%g waypoint_navigator_drone%g example_drone%g"
EXPECTED=$({ for f in $PER_DRONE; do seq -f "$f" 1 "$N"; done; echo fleet_status; echo ground_station; } | LC_ALL=C sort | xargs)   # same order as python sorted()
# ours only: base-station partner objects (COMPOSE_PROFILES=partners, e.g. geocage) may be there too
own_swarm() { object_names swarm | tr ' ' '\n' | grep -xE '(waypoint_navigator_|example_)?drone[0-9]+|fleet_status|ground_station' | xargs; }
swarm_up() { [[ $(own_swarm) == "$EXPECTED" ]]; }
wait_ok "swarm.bus objects = [$EXPECTED]" 20 swarm_up || echo "      (got: [$(object_names swarm)])"

for o in $EXPECTED; do [[ $o == drone* || $o == ground_station ]] && advances swarm "$o" heartbeat; done

# ack INTEREST OBJECT METHOD ARGS_JSON -> the CommandAck's status (int) on stdout (invoke, then poll the result)
ack() {
  local id deadline
  invoke "$1" "$2" "$3" "$4" || { echo 99; return; }
  id=$(jsonq "$BODY" 'd.get("id", "")')
  [[ -n $id ]] || { echo 99; return; }
  deadline=$((SECONDS + 5))
  while ((SECONDS < deadline)); do
    api GET "/api/interests/$1/objects/$2/methods/$3/invoke/$id" || break
    if [[ $(jsonq "$BODY" 'd.get("status")') == finished ]]; then
      jsonq "$BODY" 'json.loads(d["result"])["status"]'
      return
    fi
    sleep 0.3
  done
  echo 99
}

# 2b. the template node (example_node): example_drone1 publishes its drone's position and takes setMessage
# directly over swarm.bus, then publishes the message.
example_position() { prop swarm example_drone1 position && [[ $(jsonq "$BODY" 'abs(d["latitude"]) > 0') == True ]]; }
wait_ok "example_drone1.position published" 10 example_position
MESSAGE="smoke-$$"
S=$(ack swarm example_drone1 setMessage "[\"$MESSAGE\"]")
[[ $S == 0 ]] && pass "example_drone1 setMessage accepted" || fail "example_drone1 setMessage accepted" "ack status $S"
example_message() { prop swarm example_drone1 message && [[ $(jsonq "$BODY" 'd') == "$MESSAGE" ]]; }
wait_ok "example_drone1.message == $MESSAGE" 5 example_message

# 3. the airframe envelope is readable over the air (mirrored once from flight_controller.envelope onto DroneLink)
prop swarm drone1 envelope
if [[ $CODE == 2* ]] && [[ $(jsonq "$BODY" 'd["cruiseSpeed"] > 0 and d["arrivalRadius"] > 0') == True ]]; then
  pass "drone1.envelope over the air" "$BODY"
else
  fail "drone1.envelope over the air" "HTTP $CODE: $BODY"
fi

# 4. each drone bus (SEN session drone<ID>, joined by that drone's compose project only) holds only its own
# drone's objects: exactly one flight_controller, and its droneId is that drone's (drone1 and drone2 are enough).
for i in $(seq 1 $((N < 2 ? N : 2))); do
  interest "d$i" "SELECT * FROM drone$i.bus"
  own_flight_controller() { object_names "d$i" | tr ' ' '\n' | grep -cx flight_controller | grep -qx 1 \
              && prop "d$i" flight_controller droneId && [[ $(jsonq "$BODY" 'd') == "$i" ]]; }
  wait_ok "drone$i.bus holds one flight_controller, droneId $i" 20 own_flight_controller || echo "      (got: [$(object_names "d$i")])"
done

# 5. sim bus: world clock advances
interest sim "SELECT * FROM sim.bus"
world_up() { [[ $(object_count sim) -ge 1 ]]; }
wait_ok "sim.bus/world discovered" 10 world_up
advances sim world simTime
prop sim world airspace   # a static from config/world.yaml, for the UI
if [[ $CODE == 2* ]] && [[ $(jsonq "$BODY" 'len(d["geocage"]) >= 3') == True ]]; then
  pass "world.airspace geocage" "$(jsonq "$BODY" 'len(d["geocage"])') vertices"
else
  fail "world.airspace geocage" "HTTP $CODE: $BODY"
fi

# 6. truth objects on the sim bus (published by each airframe), read through the same `sim` interest
TRUTH_EXPECTED=$(seq -f 'truth_drone%g' 1 "$N" | sort | xargs)
truth_up() { [[ $(object_names sim DroneTruth) == "$TRUTH_EXPECTED" ]]; }
wait_ok "sim.bus truth objects = [$TRUTH_EXPECTED]" 20 truth_up || echo "      (got: [$(object_names sim DroneTruth)])"

if [[ -z $SCEN ]]; then
# 7. a route for drone1, sent BEFORE takeoff (waypoint_navigator accepts it in any mode and flies it once
# airborne), then arm + takeoff and the true altitude rising; every command is a call on the drone's own
# object on swarm.bus, drone1 or waypoint_navigator_drone1. Safe to re-run
# against a stack that is already flying: the route is simply flown from where the drone is.
truth_alt() { prop sim truth_drone1 state && jsonq "$BODY" 'd["position"]["altitude"]'; }

# Two waypoints ~330 m north and then ~330 m east of where drone1 is (0.003 deg lat = 334 m).
ROUTE=$(prop swarm drone1 telemetry && jsonq "$BODY" \
  '"[{\"id\": 1, \"waypoints\": [%s, %s]}, 0.0]" % tuple("{\"latitude\": %s, \"longitude\": %s, \"altitude\": 120.0}" % (d["position"]["latitude"] + 0.003, d["position"]["longitude"] + dl) for dl in (0.0, 0.006))')
S=$(ack swarm waypoint_navigator_drone1 setRoute "$ROUTE")
[[ $S == 0 ]] && pass "waypoint_navigator_drone1 setRoute accepted (before takeoff)" || fail "waypoint_navigator_drone1 setRoute accepted" "ack status $S"

# Re-runnable: arm only if disarmed (0), take off unless already airborne (2..5 = takeoff, hold,
# goingTo, land). Mode 1 (armed) is on the ground and still needs the takeoff. Mode 6 (crashed)
# refuses every command: restart the stack.
MODE=$(prop swarm drone1 telemetry && jsonq "$BODY" 'd["mode"]')
if [[ $MODE == 0 ]]; then
  S=$(ack swarm drone1 arm '[]')
  [[ $S == 0 ]] && pass "drone1 arm accepted" || fail "drone1 arm accepted" "ack status $S"
fi
if [[ $MODE == 0 || $MODE == 1 ]]; then
  S=$(ack swarm drone1 takeoff '[100.0]')
  [[ $S == 0 ]] && pass "drone1 takeoff accepted" || fail "drone1 takeoff accepted" "ack status $S"
elif [[ $MODE == 6 ]]; then
  fail "drone1 can fly" "mode 6 (crashed, empty battery) — restart the stack"
elif [[ $MODE =~ ^[2-5]$ ]]; then
  pass "drone1 already flying (mode $MODE)" "skipping arm/takeoff — this stack has been flown"
else
  fail "drone1 mode known (0..6)" "mode $MODE"
fi

A=$(truth_alt)
climbing() { local b; b=$(truth_alt); [[ $(python3 -c "print(($b) > 5)" 2>/dev/null) == True ]]; }
wait_ok "drone1 airborne above 5 m" 30 climbing || echo "      (alt: $A -> $(truth_alt))"

# 8. the route is flown: waypoint_navigator_drone1.status reaches arrived (2)
navigator_status() { prop swarm waypoint_navigator_drone1 status && jsonq "$BODY" 'd'; }
arrived() { [[ $(navigator_status) == 2 ]]; }
wait_ok "waypoint_navigator_drone1 status == arrived (route flown)" 120 arrived || echo "      (status: $(navigator_status), currentIndex: $(prop swarm waypoint_navigator_drone1 currentIndex && jsonq "$BODY" 'd'))"

# 8b. after the route: drone1 holds (3), then drone1.land -> disarmed (0) on the ground
drone1_mode() { prop swarm drone1 telemetry && jsonq "$BODY" 'd["mode"]'; }
holding() { [[ $(drone1_mode) == 3 ]]; }
wait_ok "drone1 holds after the route (mode hold)" 10 holding || echo "      (mode: $(drone1_mode))"
S=$(ack swarm drone1 land '[]')
[[ $S == 0 ]] && pass "drone1 land accepted" || fail "drone1 land accepted" "ack status $S"
landed() { [[ $(drone1_mode) == 0 ]]; }
wait_ok "drone1 landed and disarmed (mode disarmed)" 120 landed || echo "      (mode: $(drone1_mode), alt: $(truth_alt))"

else
  "$(dirname "$0")/scenario.py" "$SCEN" --check | sed '$d'   # its PASS/FAIL lines; ALL PASS comes below
  ((PIPESTATUS[0] == 0)) || FAILURES=$((FAILURES + 1))
fi

# 9. fleet_status (the ground_station example node) counts every drone alive
alive_count() { prop swarm fleet_status aliveCount && jsonq "$BODY" 'd'; }
all_alive() { [[ $(alive_count) == "$N" ]]; }
wait_ok "fleet_status.aliveCount == $N" 10 all_alive || echo "      (got: $(alive_count))"

echo
if ((FAILURES == 0)); then echo "ALL PASS"; else echo "$FAILURES FAILURE(S)"; exit 1; fi
