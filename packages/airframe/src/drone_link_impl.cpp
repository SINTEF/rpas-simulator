// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#include "drone_link_impl.h"

#include "sen_helpers.h"

#include <utility>

namespace airframe
{

using sen_helpers::first;

namespace
{
constexpr double kHeartbeatPeriod = 0.1;  // s: 10 Hz, the flight controller's publish rate

// The flight controller answered (or the call itself failed): the ack the caller gets.
drone_sim::CommandAck ackOf(const sen::MethodResult<drone_sim::CommandAck>& result)
{
  return result.isOk() ? result.getValue()
                       : drone_sim::CommandAck {drone_sim::AckStatus::rejectedUnavailable, "call failed on the drone bus"};
}
}  // namespace

void DroneLinkImpl::update(sen::kernel::RunApi& api)
{
  if (flightControllerSub_ == nullptr)
  {
    // Opened here, not in registered(): SEN runs registered() holding this object's session lock (swarm), and
    // opening another session's bus there deadlocks against a drone-bus node doing the reverse (lock order, ARCHITECTURE.md section 8).
    flightControllerSub_ = api.selectAllFrom<drone_sim::FlightControllerInterface>(getDroneBus());
  }
  const drone_sim::FlightControllerInterface* flightController = first(flightControllerSub_);
  if (flightController == nullptr)
  {
    return;  // no vehicle behind drone<ID> yet (or any more): it stays, stale, and its heartbeat stops
  }
  if (flightController->getEnvelope() != getEnvelope())
  {
    setNextEnvelope(flightController->getEnvelope());  // [confirmed], published once
  }
  // Staged on change only: the component runs at 50 Hz, the flight controller publishes at its
  // publishRate (10 Hz), so this is that rate over the air.
  if (flightController->getState() != getNextTelemetry())
  {
    setNextTelemetry(flightController->getState());
  }
  // The heartbeat is this link's own: it advances at kHeartbeatPeriod for as long as a flight
  // controller is behind it -- also while the sim is paused and the state stands still -- and stops
  // with this process (fleet_monitor's lostAfter).
  const sen::TimeStamp now = api.getTime();
  if (!lastBeat_ || (now - *lastBeat_).toSeconds() >= kHeartbeatPeriod)
  {
    lastBeat_ = now;
    setNextHeartbeat(getHeartbeat() + 1);
  }
}

drone_sim::FlightControllerInterface* DroneLinkImpl::flightControllerOr(std::promise<drone_sim::CommandAck>& promise)
{
  drone_sim::FlightControllerInterface* flightController = first(flightControllerSub_);
  if (flightController == nullptr)
  {
    promise.set_value({drone_sim::AckStatus::rejectedUnavailable, "no flight_controller"});
  }
  return flightController;
}

// --- command forwarding -------------------------------------------------------------------------
// One method per command: find the flight controller, call it, hand its ack back through the
// promise. The result callback owns the promise until the flight controller answers (1-2 cycles
// later); sen::MethodCallback wraps a move-only function, so the promise moves into the lambda.

void DroneLinkImpl::armImpl(std::promise<drone_sim::CommandAck>&& promise)
{
  if (auto* flightController = flightControllerOr(promise))
  {
    flightController->arm({this, [p = std::move(promise)](const auto& r) mutable { p.set_value(ackOf(r)); }});
  }
}

void DroneLinkImpl::disarmImpl(std::promise<drone_sim::CommandAck>&& promise)
{
  if (auto* flightController = flightControllerOr(promise))
  {
    flightController->disarm({this, [p = std::move(promise)](const auto& r) mutable { p.set_value(ackOf(r)); }});
  }
}

void DroneLinkImpl::takeoffImpl(double altitudeAboveGround, std::promise<drone_sim::CommandAck>&& promise)
{
  if (auto* flightController = flightControllerOr(promise))
  {
    flightController->takeoff(altitudeAboveGround,
                              {this, [p = std::move(promise)](const auto& r) mutable { p.set_value(ackOf(r)); }});
  }
}

void DroneLinkImpl::landImpl(std::promise<drone_sim::CommandAck>&& promise)
{
  if (auto* flightController = flightControllerOr(promise))
  {
    flightController->land({this, [p = std::move(promise)](const auto& r) mutable { p.set_value(ackOf(r)); }});
  }
}

void DroneLinkImpl::goToPositionImpl(const drone_sim::GeoPosition& target,
                                     double speed,
                                     std::promise<drone_sim::CommandAck>&& promise)
{
  if (auto* flightController = flightControllerOr(promise))
  {
    flightController->goToPosition(
      target, speed, {this, [p = std::move(promise)](const auto& r) mutable { p.set_value(ackOf(r)); }});
  }
}

void DroneLinkImpl::setVelocityImpl(const drone_sim::Vec3& velocity, std::promise<drone_sim::CommandAck>&& promise)
{
  if (auto* flightController = flightControllerOr(promise))
  {
    flightController->setVelocity(velocity,
                                  {this, [p = std::move(promise)](const auto& r) mutable { p.set_value(ackOf(r)); }});
  }
}

SEN_EXPORT_CLASS(DroneLinkImpl)

}  // namespace airframe
