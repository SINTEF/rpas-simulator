# [Bug report — ready to file at github.com/airbus/sen]

## REST: a method invoke with a wrongly shaped argument aborts the whole process ("var is not a sequence")

**Affected version:** main @ `05da288e` (built 2026-09-14). Linux x86-64 (Ubuntu 22.04, WSL2), GCC 12.3,
Release. Found 2026-09-30, reproduced natively with `scripts/run_native.sh 1` (world process).

### Summary

`POST /api/interests/<i>/objects/<o>/methods/<m>/invoke` with a body whose argument count is right but
whose argument *shape* does not match the method's type (a JSON object where an `array<f64, 3>` is
expected) does not return an HTTP 400: the process hosting the `rest` component dies with an unhandled
`std::runtime_error`. Every other object of that process and every other REST client go with it. Any
browser (or typo in a script) can kill the process.

### Reproduction

A process with `rest` and `ether` loaded; on `swarm.bus` a remote object whose class has

```
array<f64, 3> Vec3;
fn setVelocity(velocity : Vec3) -> CommandAck;
```

```bash
R=http://localhost:8080; J=$(mktemp)
c() { curl -sS -b $J -c $J -H 'Content-Type: application/json' "$@"; echo; }
c -X POST $R/api/auth -d '{"id":"repro"}'
c -X POST $R/api/interests -d '{"name":"swarm","query":"SELECT * FROM swarm.bus"}'
c -X POST $R/api/interests/swarm/objects/drone1/methods/setVelocity/invoke -d '[[0.0, 0.0, 0.0]]'
#   {"id":0,"status":"pending"}                      right shape: fine
c -X POST $R/api/interests/swarm/objects/drone1/methods/setVelocity/invoke \
  -d '[{"north": 1.0, "east": 0.0, "down": 0.0}]'
#   curl: (52) Empty reply from server               wrong shape: the process is gone
c $R/api/interests/swarm/objects
#   curl: (7) Failed to connect to localhost port 8080
```

The process's output:

```
sen: Unhandled runtime exception: 'var is not a sequence'
sen: Crash report written to /tmp/world_2026_09_30_20_41_46_0x8e361836ca4071dc.json
```

(the crash report holds `exceptionKind: runtime`, no stack.)

### Likely cause

`SenRouter::invokeMethodHandler` (`components/rest/src/sen_router.cpp`) catches JSON parse errors of
the body, and `checkValidExpectedArgs` checks the arguments against `method->getArgs()`, but not their
shape against the argument types. The `VarList` is then handed on and converted to the native type later
(`VariantTraits<std::array>::variantToValue`, `libs/core/include/sen/core/io/util.h`, which throws
"var is not a sequence"), outside any `try`, so the exception reaches the top of the thread.

### Proposed fix

Validate (or convert) the arguments against the method's argument types inside the handler's `try` and
answer `400 {"error": "argument 1: var is not a sequence"}`; or catch around the conversion wherever it
runs and fail the invoke (`status: finished`, an error result) instead of the process.

### Impact / workaround

A REST client error takes down a simulation process. Workaround in drone_sim: the UI and scripts send only
argument shapes known to work (`viz/app/sen/commands.js`, covered by `viz/test/commands.test.js`: a
`GeoPosition` as an object, a `Vec3` as `[n, e, d]`).
