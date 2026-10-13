// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#pragma once

#include "sen/core/obj/subscription.h"
#include "sen/kernel/component_api.h"
#include "stl/drone_sim/sim/airframe.stl.h"
#include "stl/drone_sim/sim_bus/truth.stl.h"

#include <memory>

namespace airframe
{

// sim.bus/truth_drone<ID>: the true airframe state, a YAML object of the airframe component
// that mirrors flight_controller.state (one cycle of lag, invisible to the view). Pure data sink -- the 3D view
// renders from this, nobody writes to it from outside.
class DroneTruthImpl: public drone_sim::SimDroneTruthBase<drone_sim::DroneTruthBase>
{
public:
  SEN_NOCOPY_NOMOVE(DroneTruthImpl)

  using drone_sim::SimDroneTruthBase<drone_sim::DroneTruthBase>::SimDroneTruthBase;
  ~DroneTruthImpl() override = default;

  void update(sen::kernel::RunApi& api) override;

private:
  std::shared_ptr<sen::Subscription<drone_sim::FlightControllerInterface>> flightControllerSub_;
};

}  // namespace airframe
