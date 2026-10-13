// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#pragma once

#include "sen/core/base/timestamp.h"
#include "sen/kernel/component_api.h"
#include "stl/drone_sim/sim_bus/ground_asset.stl.h"
#include "stl/drone_sim/sim_bus/world.stl.h"

#include <memory>
#include <optional>

namespace world
{

// Kinematic waypoint-loop follower on the flat plane (sim.bus/tank1, truck1, ...).
// Configured entirely by statics from world.yaml (assetType, speed, waypoints).
// dt = measured api.getTime() delta x world.timeScale, frozen while world.paused (subscribed on sim.bus/world).
class GroundAssetImpl: public drone_sim::GroundAssetBase
{
public:
  SEN_NOCOPY_NOMOVE(GroundAssetImpl)

  using drone_sim::GroundAssetBase::GroundAssetBase;
  ~GroundAssetImpl() override = default;

  void registered(sen::kernel::RegistrationApi& api) override;
  void update(sen::kernel::RunApi& api) override;

private:
  std::shared_ptr<sen::Subscription<drone_sim::WorldInterface>> worldSub_;
  drone_sim::GeoPosition position_ {};
  double heading_ = 0.0;
  std::optional<sen::TimeStamp> lastTick_;  // api.getTime() of the previous update (dt base); none before the first
  std::size_t target_ = 0;  // index of the waypoint being approached
};

}  // namespace world
