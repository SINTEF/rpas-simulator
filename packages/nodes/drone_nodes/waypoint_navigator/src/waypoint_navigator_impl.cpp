// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#include "waypoint_navigator_impl.h"

#include "geo.h"
#include "sen_helpers.h"

#include <cmath>
#include <iostream>

namespace waypoint_navigator
{

using sen_helpers::first;

namespace
{
bool airborne(drone_sim::FlightMode m)
{
  // takeoff counts: a goToPosition during the launch run is queued by the flight controller and applied once airborne.
  return m == drone_sim::FlightMode::takeoff || m == drone_sim::FlightMode::hold || m == drone_sim::FlightMode::goingTo;
}
}  // namespace

void WaypointNavigatorImpl::registered(sen::kernel::RegistrationApi& /*api*/)
{
  setNextStatus(status_);
  setNextCurrentIndex(0);
  setNextDistanceToNext(0.0);
}

void WaypointNavigatorImpl::update(sen::kernel::RunApi& api)
{
  if (flightControllerSub_ == nullptr)
  {
    // Opened here, not in registered(): SEN runs registered() holding this object's session lock (swarm), and
    // opening another session's bus there deadlocks against a drone-bus node doing the reverse (lock order, ARCHITECTURE.md section 8).
    flightControllerSub_ = api.selectAllFrom<drone_sim::FlightControllerInterface>(getDroneBus());
  }
  drone_sim::FlightControllerInterface* flightController = first(flightControllerSub_);
  if (flightController != nullptr && !route_.waypoints.empty())
  {
    setNextDistanceToNext(geo::horizontalDistance(flightController->getState().position, route_.waypoints[index_]));
  }
  if (status_ == drone_sim::NavigatorStatus::navigating && flightController != nullptr)
  {
    const drone_sim::VehicleState& state = flightController->getState();
    const drone_sim::GeoPosition& target = route_.waypoints[index_];

    if (!airborne(state.mode))
    {
      commanded_ = false;  // on the ground (or landing): wait, the route stays loaded
    }
    else if (!commanded_)
    {
      commandWaypoint(*flightController);
    }
    else if (geo::horizontalDistance(state.position, target) <= flightController->getEnvelope().arrivalRadius)
    {
      // Reached: the flight controller is switching to hold around it; hand it the next one right away.
      if (++index_ < route_.waypoints.size())
      {
        commandWaypoint(*flightController);
      }
      else
      {
        --index_;  // keep pointing at the last waypoint
        status_ = drone_sim::NavigatorStatus::arrived;
        arrived(route_.id);  // the SEN event, delivered with this cycle's commit
      }
    }
  }
  setNextStatus(status_);
  setNextCurrentIndex(static_cast<uint32_t>(index_));
}

void WaypointNavigatorImpl::commandWaypoint(drone_sim::FlightControllerInterface& flightController)
{
  commanded_ = true;
  // Asynchronous: the ack comes back through the callback one or two cycles later. "accepted" may
  // mean "queued until airborne", so progress is judged by distance, never by the ack. The
  // sequence number makes a late ack of a route that was cancelled or replaced meanwhile harmless.
  flightController.goToPosition(route_.waypoints[index_],
              speed_,
              {this,
               [this, seq = commandSequence_](const sen::MethodResult<drone_sim::CommandAck>& r)
               {
                 if (seq != commandSequence_)
                 {
                   return;
                 }
                 if (!r.isOk() || r.getValue().status != drone_sim::AckStatus::accepted)
                 {
                   std::cerr << getName() << ": goToPosition refused"
                             << (r.isOk() ? " (" + r.getValue().message + ")" : "") << ", route dropped" << std::endl;
                   status_ = drone_sim::NavigatorStatus::idle;
                 }
               }});
}

drone_sim::CommandAck WaypointNavigatorImpl::setRouteImpl(const drone_sim::Route& route, double speed)
{
  if (route.waypoints.empty())
  {
    return {drone_sim::AckStatus::rejectedInvalid, "route has no waypoints"};
  }
  for (const drone_sim::GeoPosition& waypoint: route.waypoints)
  {
    if (!std::isfinite(waypoint.latitude.get()) || !std::isfinite(waypoint.longitude.get()) ||
        !std::isfinite(waypoint.altitude.get()))
    {
      return {drone_sim::AckStatus::rejectedInvalid, "waypoint is not finite"};
    }
  }
  if (!std::isfinite(speed) || speed < 0.0)
  {
    return {drone_sim::AckStatus::rejectedInvalid, "speed must be finite and >= 0"};
  }
  route_ = route;
  speed_ = speed;
  index_ = 0;
  status_ = drone_sim::NavigatorStatus::navigating;
  commanded_ = false;
  ++commandSequence_;
  setNextRoute(route_);  // staging from a method impl is fine; SEN only transmits a changed value
  return {drone_sim::AckStatus::accepted, std::to_string(route.waypoints.size()) + " waypoints"};
}

drone_sim::CommandAck WaypointNavigatorImpl::cancelImpl()
{
  status_ = drone_sim::NavigatorStatus::idle;
  commanded_ = false;
  ++commandSequence_;
  return {drone_sim::AckStatus::accepted, ""};
}

SEN_EXPORT_CLASS(WaypointNavigatorImpl)

}  // namespace waypoint_navigator
