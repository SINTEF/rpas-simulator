# [Bug report — ready to file at github.com/airbus/sen]

## core: removing a property connection that is not the newest segfaults the host process (`NativeObjectProxy::senImplRemoveUntypedConnection`)

**Affected version:** main @ `05da288e` (built 2026-09-14); the same code is on `main` @ `ff93ae62`
(2026-10-12). Linux x86-64 (Ubuntu 22.04, WSL2), GCC 12.3, Release. Found 2026-09-28 (in drone_sim),
six crashes of the process hosting `rest`, then reproduced on demand.

### Summary

Two subscribers (two REST client sessions, or any two components using `onPropertyChangedUntyped`)
connect to the same property of an object native to the process. When the *older* connection is
removed, the process dies with SIGSEGV. Removing the newest (last) connection is fine. Through REST
this is reached by re-authenticating an existing client id (`POST /api/auth` erases the old
`ClientSession`, whose guards remove their connections) or by `POST …/properties/<p>/unsubscribe`
from a session that is not the newest. Any REST client can kill the process.

### Reproduction

A process with `rest` and `ether`, hosting a native object `world` on `sim.bus` with a property
`simTime` that changes every cycle; REST on `127.0.0.1:8080`.

```bash
R=http://127.0.0.1:8080
auth() { curl -s -X POST $R/api/auth -H 'Content-Type: application/json' -d "{\"id\":\"$1\"}" \
         | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])'; }
setup() { T=$(auth $1)
  curl -s -X POST $R/api/interests -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
       -d '{"name":"sim","query":"SELECT * FROM sim.bus"}'; sleep 1
  curl -s -X POST $R/api/interests/sim/objects/world/properties/simTime/subscribe \
       -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{}'; }
setup repro-A; setup repro-B
auth repro-A >/dev/null; sleep 2     # the older session re-authenticates: the process is gone
```

Control: re-authenticating `repro-B` (the newest) instead does not crash. The process's output:

```
sen: Terminate called without an active exception
Segmentation fault
```

The crash report's stack (the faulting PC was the same in every report):

```
NativeObjectProxy::senImplRemoveUntypedConnection
  ← ConnectionGuard::~ConnectionGuard
  ← ClientSession::~ClientSession
  ← SenRouter::clientAuthSessionHandler
```

### Root cause

`libs/core/src/obj/native_object_proxy.cpp`, `NativeObjectProxy::senImplRemoveUntypedConnection`
(lines ~146-155 at `05da288e`, ~150-156 at `ff93ae62`):

```cpp
const auto removeStart = std::remove_if(callbackList.begin(), callbackList.end(),
                                        [&](const auto& elem) { return elem.id == id.get(); });
for (auto it = removeStart; it != callbackList.end(); ++it)
  it->callback->lock().invalidate();   // [removeStart, end) holds moved-from elements: callback is null
callbackList.erase(removeStart, callbackList.end());
```

`std::remove_if` moves the kept elements forward; the range `[removeStart, end)` then holds
moved-from elements (null `shared_ptr`), not the removed ones. `callback->lock()` dereferences null
unless the removed connection was already the last element. `NativeObject::senImplRemoveUntypedConnection`
and `RemoteObject::senImplRemoveUntypedConnection` do not have this problem (find + erase).

### Proposed fix

Partition before invalidating, so the range holds the removed elements:

```cpp
const auto removeStart = std::stable_partition(callbackList.begin(), callbackList.end(),
                                               [&](const auto& elem) { return elem.id != id.get(); });
for (auto it = removeStart; it != callbackList.end(); ++it)
  it->callback->lock().invalidate();
callbackList.erase(removeStart, callbackList.end());
```

Secondary: `~ClientSession` (`components/rest/src/client_session.cpp:40-48` at `05da288e`) releases
its interests (`release(false)`) before its members' connection guards are destroyed; the guards
should go first.

### Impact / workaround

A REST client (a browser tab reconnecting, a script unsubscribing) takes down a simulation process;
`RECORD=true` (the recorder is a permanent second subscriber) makes one re-auth enough. Workaround in
drone_sim: the UI authenticates with a fresh client id on every connect and never unsubscribes
(`viz/sen_client.js`), which leaks one idle REST session per page load.

### Related crashes, not this defect (for context)

Seen once each on the pinned build while drones left or rejoined a running `world`; not reproduced,
stacks only (drone_sim): SIGSEGV in a `RemoteObject::senImplEventEmitted`
work item drained by the `rest` component after the remote object was gone; SIGSEGV in
`iterateOverDependentTypes ← CustomTypeRegistry::add ← RemoteParticipant::registerRemoteTypeFoundInBus`
when a participant rejoined; a `pthread_mutex_lock` assertion in `RemoteParticipant::processObjectAddition`
from an `EtherTransport::startTimer` callback in a drone process as `world` died.
