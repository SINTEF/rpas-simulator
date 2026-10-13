# [Bug report — ready to file at github.com/airbus/sen]

## Ether: TCP discovery hub host segfaults when a 2nd remote participant subscribes (`std::move` inside the multicast-emulation loop)

**Affected version:** main @ `0d15e90` (built 2026-05-28). Linux x86-64
(Ubuntu 22.04, WSL2 and native), GCC 11, Release.

### Summary

With multicast disabled and a TCP discovery hub
(`busConfig.multicastDisabled: true` + `runDiscoveryHub: <port>`), the
process hosting the hub crashes with SIGSEGV ("terminate called without an
active exception") the moment a **second** remote participant subscribes to
its objects. One remote participant is stable; two or more is 100 %
reproducible, within seconds. The identical topology over default multicast
discovery is stable.

### Reproduction

1. Process A: any config that publishes objects, hosting the hub and joined
   to it (per `docs/components/ether.md` "Disabling multicast entirely"):
   ```yaml
   load:
     - name: ether
       runDiscoveryHub: 64222
       busConfig:
         multicastDisabled: true
       discovery:
         type: TcpDiscovery
         value:
           hubAddress: { host: localhost, port: 64222 }
   ```
2. Processes B and C: subscribers to A's objects, with
   ```yaml
   load:
     - name: ether
       busConfig:
         multicastDisabled: true
       discovery:
         type: TcpDiscovery
         value:
           hubAddress: { host: <hostA>, port: 64222 }
   ```
3. Start A, then B: stable — discovery, property distribution, invokes all
   work.
4. Start C: process A segfaults within seconds (as soon as it next
   distributes an object update to both remotes).

Reproduced on a bare host with three `sen run` processes — no containers
involved.

### Root cause

`components/ether/src/ether_transport.h`, both `sendTo` overloads. When
`multicastDisabled` is set, multicast sends are emulated by looping over
every ready process — but the payload is passed with `std::move` **inside
the loop**:

```cpp
case TransportMode::multicast:
{
  if (config_.busConfig.multicastDisabled)
  {
    for (auto& [id, procHandler]: readyProcesses_)
    {
      procHandler->sendBusMessageConfirmed(to, busId, std::move(data));   // line ~189
    }
  }
  ...
```

and in the two-block overload:

```cpp
    for (auto& [id, procHandler]: readyProcesses_)
    {
      procHandler->sendBusMessageConfirmed(to, busId, std::move(data1), std::move(data2));  // line ~239
    }
```

The first iteration moves the `MemBlockPtr` (a `shared_ptr<MemoryBlock>`)
out; every subsequent ready process receives a null pointer, and
`ProcessHandler::sendBusMessageConfirmed` (`process_handler.cpp:417`)
dereferences it (`data->getConstSpan()`) → SIGSEGV. Hence exactly the
observed behavior: 1 remote participant fine, 2+ fatal, and the multicast
path (`broadcast` branch) unaffected.

### Crash stack (gdb, thread 5 of the hub-hosting `cli_run`)

```
ProcessHandler::sendBusMessageConfirmed   (process_handler.cpp:417, data->getConstSpan() on null)
EtherTransport::sendTo                    (ether_transport.h, multicastDisabled loop)
RemoteParticipant::sendToBus
…::sendObjectUpdate
RemoteInterestsManager::sendObjectUpdates
LocalParticipant::flushOutputs
Runner::commit
```

### Proposed fix

Copy the `shared_ptr` per iteration instead of moving it:

```cpp
for (auto& [id, procHandler]: readyProcesses_)
{
  procHandler->sendBusMessageConfirmed(to, busId, data);          // copy, not move
}
```

(and `data1`/`data2` likewise in the second overload). If the extra refcount
per receiver matters, moving only on the last iteration preserves the
optimization.

### Impact / workaround

Any hub-based (multicast-free) topology with more than two processes is
unusable, which blocks multi-host deployments across routed networks where
multicast doesn't reach. Workaround: default multicast discovery on a shared
L2 segment (all processes on one host or one bridge network).

We now carry the proposed fix locally
(`0003-ether-fix-multicast-emulation-use-after-move.patch` in this
directory, 2026-07-17) and verified it against the reproduction above: with
the patch, the hub host survives the second and third remote participants
joining, and discovery + property distribution work to all remotes.

Related observation (pre-existing, not introduced by the fix): because the
multicast emulation sends every bus message to every ready process, each
receiver logs `[kernel] [error] session received invalid bus ID <n>` at the
publish rate for buses it has not joined. Harmless but noisy — arguably the
emulation should filter by the receiver's joined buses, or the receiver
should drop unknown-bus messages silently.
