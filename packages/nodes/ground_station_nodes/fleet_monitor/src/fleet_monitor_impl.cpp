// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#include "fleet_monitor_impl.h"

namespace fleet_monitor
{

void FleetMonitorImpl::registered(sen::kernel::RegistrationApi& api)
{
  setNextAliveCount(0);
  setNextLostCount(0);
  linkSub_ = api.selectAllFrom<drone_sim::DroneLinkInterface>(
    getSwarmBus(),
    [this](const auto& added)
    {
      for (auto* link: added)
      {
        Seen& drone = seen_[link->getDroneId()];  // new, or back after a restart
        drone.link = link;
        drone.heartbeat = link->getHeartbeat();
        drone.lastChange.reset();
      }
    },
    [this](const auto& removed)
    {
      for (auto* link: removed)
      {
        for (auto& [id, drone]: seen_)
        {
          if (drone.link == link)
          {
            drone.link = nullptr;  // gone from the bus: lost until it reappears
          }
        }
      }
    });
}

void FleetMonitorImpl::update(sen::kernel::RunApi& api)
{
  const sen::TimeStamp now = api.getTime();  // measured, not the nominal cycle time
  drone_sim::DroneSummaryList drones;
  uint32_t alive = 0;
  for (auto& [id, drone]: seen_)
  {
    if (drone.link != nullptr)
    {
      if (!drone.lastChange || drone.link->getHeartbeat() != drone.heartbeat)
      {
        drone.heartbeat = drone.link->getHeartbeat();
        drone.lastChange = now;
      }
      const drone_sim::VehicleState& telemetry = drone.link->getTelemetry();
      drone.mode = telemetry.mode;
      drone.battery = telemetry.battery;
    }
    const double sinceHeartbeat = drone.lastChange ? (now - *drone.lastChange).toSeconds() : 0.0;
    const bool isAlive = drone.link != nullptr && sinceHeartbeat < getLostAfter();
    alive += isAlive ? 1 : 0;
    drones.push_back({id, isAlive, drone.mode, drone.battery, sinceHeartbeat});
  }
  setNextAliveCount(alive);
  setNextLostCount(static_cast<uint32_t>(drones.size()) - alive);
  setNextDrones(drones);
}

SEN_EXPORT_CLASS(FleetMonitorImpl)

}  // namespace fleet_monitor
