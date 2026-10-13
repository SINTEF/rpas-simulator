// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#pragma once

#include "sen/core/obj/subscription.h"
#include "sen/kernel/component_api.h"
#include "stl/drone_sim/drone_bus/flight_controller.stl.h"
#include "stl/drone_sim/swarm_bus/waypoint_navigator.stl.h"

#include <memory>

namespace waypoint_navigator
{

// Demonstration node: shows SEN subscriptions, async flight-controller calls, progress publication,
// and events. Its waypoint-following behavior is illustrative, not the final project's autonomous
// navigation or coordination architecture. Partner nodes implement that behavior through FlightController.
// swarm.bus/waypoint_navigator_drone<ID>: flies a Route through flight_controller.goToPosition() (on droneBus),
// one waypoint at a time. On swarm.bus because the ground side (the UI, scripts, a base-station component)
// calls it (ARCHITECTURE.md section 3).
// The command methods only touch plain members (they run during the drain); update() does the
// flying and stages every property.
class WaypointNavigatorImpl: public drone_sim::WaypointNavigatorBase
{
public:
  SEN_NOCOPY_NOMOVE(WaypointNavigatorImpl)

  using drone_sim::WaypointNavigatorBase::WaypointNavigatorBase;
  ~WaypointNavigatorImpl() override = default;

  void registered(sen::kernel::RegistrationApi& api) override;
  void update(sen::kernel::RunApi& api) override;

protected:
  drone_sim::CommandAck setRouteImpl(const drone_sim::Route& route, double speed) override;
  drone_sim::CommandAck cancelImpl() override;

private:
  // flight_controller.goToPosition() for waypoints[index_]; the ack arrives a cycle later.
  void commandWaypoint(drone_sim::FlightControllerInterface& flightController);

  std::shared_ptr<sen::Subscription<drone_sim::FlightControllerInterface>> flightControllerSub_;

  drone_sim::Route route_ {};
  double speed_ = 0.0;
  std::size_t index_ = 0;
  drone_sim::NavigatorStatus status_ = drone_sim::NavigatorStatus::idle;
  bool commanded_ = false;  // goToPosition() for waypoints[index_] has been issued
  unsigned commandSequence_ = 0;     // bumped by setRoute/cancel so a late ack of an old route is ignored
};

}  // namespace waypoint_navigator
