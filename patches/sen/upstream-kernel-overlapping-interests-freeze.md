# [Bug report — ready to file at github.com/airbus/sen]

## Kernel: a second interest matching an already-proxied remote object freezes that object's updates after 5 s

**Affected version:** main @ `05da288e` (2026-09-14) and still at main head `0d784c96`
(2026-09-22). Not present at `0d15e90e` (2026-05-28).
Linux x86-64 (Ubuntu 22.04, WSL2 and Docker), GCC 12, Release. Reproduced natively (three
`sen run` processes, no containers) and under docker compose.

### Summary

When a consumer process already holds a proxy for a remote object through one interest and a
**second, different** interest that also matches that object is added in the same process, the
object's property updates stop arriving in that process exactly 5 s later
(`remoteObjectResolutionTimeout`) and never resume — not even after both interests are removed and
a fresh one is created. Other objects, other buses and other processes are unaffected. Any two
distinct queries that overlap trigger it: `SELECT * FROM a.b` + `SELECT pkg.Type FROM a.b`, or
`SELECT pkg.Type FROM a.b` + `SELECT pkg.Type FROM a.b WHERE name = "x"` (then only `x` freezes).
Repeating the *same* query, or two typed queries whose object sets are disjoint, is fine.

### Reproduction (REST is the easiest consumer; any component with two `selectAllFrom` calls will do)

1. Process A: an object with a `[confirmed]` property published at 10 Hz on bus `a.b`
   (e.g. one drone of https://github.com/…/drone_sim_v4, `config/drone.yaml`).
2. Process B: `ether` + `rest` on :8080 (any config; B publishes nothing).
3. Against B's REST:
   ```
   POST /api/auth {"id":"x"}
   POST /api/interests {"name":"all",   "query":"SELECT * FROM a.b"}
   GET  /api/interests/all/objects/<obj>/properties/<prop>      # advances
   POST /api/interests {"name":"typed", "query":"SELECT pkg.Type FROM a.b"}
   ```
4. Within ~1 s both interests return the same, advancing value. **5 s after step 3's second
   POST** the value stops changing on both, for good. A second REST client in B sees the
   same frozen value; a third process C joining `a.b` afterwards sees the object advance.

### Root cause (from reading `libs/kernel/src/bus/`)

`fix(kernel): share one proxy per object and consumer (#127)`, `9aa2b250`, introduced a
per-`LocalParticipant` proxy cache (`lookUpProxyByObjectId`) so overlapping interests reuse
one proxy. But `RemoteParticipant::remoteObjectsPublished` still calls
`monitoredObjects_.startMonitoring(object, transport, timeoutCallback)` for the object under
the **second** interest (the first proxy had already stopped its monitor, so `data_` has no entry
and a new 5 s timer is started). Because `ProxyManager::getOrCreateProxy` now returns the cached
proxy, `startTrackingProxy` — the only place that calls `applyStateAndStopMonitoring` — is never
called for the second interest, so nothing cancels that timer. When it fires, the callback sends
`PublicationRejection {id, interestId, Timeout {}}` to the publisher, whose
`RemoteInterestsHandler::removeRejectedObject(remote, update)` removes the object from that
remote's update set: the publisher stops sending the object to this process altogether.

Suggested fix: in `remoteObjectsPublished`, treat an object that the local participant already
proxies (`lookUpProxyByObjectId(object.id)` non-null) as `repeated` for monitoring purposes — do
not start a resolution timer for it — or have `getOrCreateProxy` stop the monitor when it hands
out a cached proxy.

### Workaround used downstream

Never hold two different interests that match the same remote object in one process: every REST
client uses one `SELECT * FROM <bus>` per bus and dispatches on `className`.
