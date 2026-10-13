// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#pragma once

#include "sen/core/obj/subscription.h"
#include "sen/kernel/component_api.h"
#include "stl/drone_sim/drone_bus/flight_controller.stl.h"
#include "stl/drone_sim/sim/imaging_sensor.stl.h"
#include "stl/drone_sim/sim_bus/ground_asset.stl.h"

#include <memory>
#include <string>

namespace imaging_sensor
{

// drone<ID>.bus/sensor: the simulated ISTAR EO/IR payload. Reports every ground asset within
// slant range and inside a fixed, downward-looking cone (vehicle attitude ignored) as a Track.
//
// SIM-ONLY EXCEPTION: this node READS sim.bus (ground-asset truth) because it stands in for
// hardware, exactly like the airframe (ARCHITECTURE.md 4.3). No other node kind may. Its typed
// interest is disjoint from the airframe's (World vs GroundAsset), which is what keeps it clear
// of the overlapping-interest freeze (ARCHITECTURE.md 8).
class ImagingSensorImpl: public drone_sim::SimSensorBase<drone_sim::SensorBase>
{
public:
  SEN_NOCOPY_NOMOVE(ImagingSensorImpl)

  using drone_sim::SimSensorBase<drone_sim::SensorBase>::SimSensorBase;
  ~ImagingSensorImpl() override = default;

  void registered(sen::kernel::RegistrationApi& api) override;
  void update(sen::kernel::RunApi& api) override;

private:
  // Own pose: flight_controller.state on the drone bus (the flight controller may appear after this node).
  std::shared_ptr<sen::Subscription<drone_sim::FlightControllerInterface>> flightControllerSub_;

  // "SELECT drone_sim.GroundAsset FROM sim.bus": its list is every asset currently on the bus.
  std::shared_ptr<sen::Subscription<drone_sim::GroundAssetInterface>> assetSub_;
};

}  // namespace imaging_sensor
