// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#include "drone_truth_impl.h"

#include "sen_helpers.h"

namespace airframe
{

using sen_helpers::first;

void DroneTruthImpl::update(sen::kernel::RunApi& api)
{
  if (flightControllerSub_ == nullptr)
  {
    // Opened here, not in registered(): SEN runs registered() holding this object's session lock (sim), and
    // opening another session's bus there deadlocks against a drone-bus node doing the reverse (lock order, ARCHITECTURE.md section 8).
    flightControllerSub_ = api.selectAllFrom<drone_sim::FlightControllerInterface>(getDroneBus());
  }
  if (const drone_sim::FlightControllerInterface* flightController = first(flightControllerSub_))
  {
    setNextState(flightController->getState());  // best-effort, like flight_controller.state: one struct per cycle
  }
}

SEN_EXPORT_CLASS(DroneTruthImpl)

}  // namespace airframe
