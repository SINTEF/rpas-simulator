# [Bug report — ready to file at github.com/airbus/sen]

## Kernel: `registered()` runs under the session lock, so opening a bus of another session there can deadlock the process

**Affected version:** main @ `05da288e` (2026-09-14); the same code is in the older `0d15e90e`.
Linux x86-64 (Ubuntu 22.04, WSL2), GCC 12, Release, native `sen run`.

### Summary

`LocalParticipant::add()` takes `Session::PublicLock` (the session's `busesMutex_`) and, still
holding it, calls `Runner::registerObjects()`, which calls each object's `registered(api)`. If
`registered()` subscribes to a bus of a **different** session that this component has not opened
yet (`api.selectAllFrom<T>("other.bus")` → `getSource` → `getOrCreateLocalParticipant` →
`LocalParticipant` ctor `getOrOpenBus` / `connect()`), it takes that other session's `busesMutex_`.
Two components doing this in opposite directions (object on `a.bus` opening `b.bus`, object on
`b.bus` opening `a.bus`) deadlock ABBA. Every other component thread that publishes on either
session, and the `MessageDispatcher` workers (`Session::remoteParticipantJoinedBus`), then block on
the same mutexes: the process stops handling bus traffic for good, and remote processes never see
its objects. Whether it hits depends on thread timing (more components ⇒ more likely).

### Repro

Two components in one process, same group:
- component A publishes `X` on `drone1.bus`; `X::registered()` does `selectAllFrom<Y>("swarm.bus")`
- component B publishes `Y` on `swarm.bus`; `Y::registered()` does `selectAllFrom<X>("drone1.bus")`

With ~10 such components (drone_sim ERA2 drone, `scripts/run_native.sh 3`) it hangs on every run.

### Stack evidence (gdb, `thread apply all bt`, stalled process)

```
T9  pthread_mutex_lock ← Session::lock ← LocalParticipant::connect ← Runner::getOrCreateLocalParticipant
    ← KernelApi::getSource ← selectAllFrom<DroneLinkInterface>(swarm.bus)
    ← DetectAndAvoidImpl::registered ← Runner::registerObjects ← LocalParticipant::add (holds drone1)
T11 pthread_mutex_lock ← Session::getOrOpenBus ← LocalParticipant::LocalParticipant ← getOrCreateLocalParticipant
    ← KernelApi::getSource ← selectAllFrom<FlightControllerInterface>(drone1.bus)
    ← ManageMissionImpl::registered ← Runner::registerObjects ← LocalParticipant::add (holds swarm)
T10,12-18  Session::lock ← LocalParticipant::add ← PipelineComponent::publishObjects
T19,T20    pthread_mutex_lock ← Session::remoteParticipantJoinedBus ← MessageDispatcher::Worker::processWork
```

### Suspected code site

`libs/kernel/src/bus/local_participant.cpp`, `LocalParticipant::add()`: `owner_->registerObjects(instances)`
is called inside the `Session::PublicLock` scope. Fix: release the session lock before
`registerObjects()` (or defer the `registered()` calls to the runner loop).

### Workaround (drone_sim)

Objects on a shared bus (`swarm.bus`, `sim.bus`) open `drone<ID>.bus` in their first `update()`
instead of `registered()`, so `registered()` only ever takes locks in one order (drone → shared).
