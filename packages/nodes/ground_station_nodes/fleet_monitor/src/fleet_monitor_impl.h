// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#pragma once

#include "sen/core/obj/subscription.h"
#include "sen/kernel/component_api.h"
#include "stl/drone_sim/nodes/fleet_monitor.stl.h"
#include "stl/drone_sim/swarm_bus/drone_link.stl.h"

#include <map>
#include <memory>
#include <optional>
#include <string>

namespace fleet_monitor
{

// swarm.bus/fleet_status: tracks every drone<ID> on the swarm bus.
class FleetMonitorImpl: public drone_sim::FleetMonitorBase
{
public:
  SEN_NOCOPY_NOMOVE(FleetMonitorImpl)

  using drone_sim::FleetMonitorBase::FleetMonitorBase;
  ~FleetMonitorImpl() override = default;

  void registered(sen::kernel::RegistrationApi& api) override;
  void update(sen::kernel::RunApi& api) override;

private:
  struct Seen
  {
    drone_sim::DroneLinkInterface* link = nullptr;  // null once the object has gone
    uint64_t heartbeat = 0;
    // api.getTime() when the heartbeat last advanced; none until update() first sees the object
    // (the added callback has no RunApi). TimeStamp{} is no sentinel: a TestKernel starts there.
    std::optional<sen::TimeStamp> lastChange;
    drone_sim::FlightMode mode = drone_sim::FlightMode::disarmed;
    double battery = 0.0;
  };

  // "SELECT drone_sim.DroneLink FROM swarm.bus": one typed interest, every drone. This is the one node
  // that keeps the added/removed callbacks on purpose: a drone that has left the bus must still be
  // reported as lost, and the subscription's list no longer holds it.
  std::shared_ptr<sen::Subscription<drone_sim::DroneLinkInterface>> linkSub_;
  std::map<std::string, Seen> seen_;  // by droneId; a drone is never forgotten
};

}  // namespace fleet_monitor
