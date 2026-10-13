// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#pragma once

#include "sen/kernel/component_api.h"
#include "stl/drone_sim/swarm_bus/ground_station.stl.h"

namespace ground_station
{

// Publishes swarm.bus/ground_station: the base station's heartbeat (C2 liveness). It forwards no
// commands: operators call the drone's own objects on swarm.bus.
class GroundStationImpl: public drone_sim::GroundStationBase
{
public:
  SEN_NOCOPY_NOMOVE(GroundStationImpl)

  using drone_sim::GroundStationBase::GroundStationBase;
  ~GroundStationImpl() override = default;

  void registered(sen::kernel::RegistrationApi& api) override;
  void update(sen::kernel::RunApi& api) override;
};

}  // namespace ground_station
