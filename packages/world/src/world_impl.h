// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#pragma once

#include "sen/core/base/timestamp.h"
#include "sen/kernel/component_api.h"
#include "stl/drone_sim/sim_bus/world.stl.h"

#include <optional>

namespace world
{

// Publishes sim.bus/world: sim clock advancing at timeScale x the SEN clock (api.getTime()), frozen while paused.
// Ground assets are separate YAML objects (GroundAssetImpl).
class WorldImpl: public drone_sim::WorldBase
{
public:
  SEN_NOCOPY_NOMOVE(WorldImpl)

  using drone_sim::WorldBase::WorldBase;
  ~WorldImpl() override = default;

  void registered(sen::kernel::RegistrationApi& api) override;
  void update(sen::kernel::RunApi& api) override;

protected:
  // Run during drain: only touch plain members; properties are staged in update().
  drone_sim::CommandAck setTimeScaleImpl(double scale) override;
  drone_sim::CommandAck pauseImpl() override;
  drone_sim::CommandAck resumeImpl() override;

private:
  std::optional<sen::TimeStamp> last_;  // api.getTime() of the previous update; none before the first
  double simTime_ = 0.0;
  double timeScale_ = 1.0;
  bool paused_ = false;
  double rate_ = 0.0;  // simulation seconds per wall second as published last cycle: 0 paused, else timeScale
};

}  // namespace world
