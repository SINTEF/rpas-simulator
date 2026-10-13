// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#include "example_node_impl.h"

namespace example_node
{

void ExampleNodeImpl::registered(sen::kernel::RegistrationApi& /*api*/)
{
  // setNext*() stages a value for the NEXT commit; get*() still returns the old one until then.
  // This is the earliest point where staging is allowed (not the constructor).
  setNextMessage("");
}

void ExampleNodeImpl::update(sen::kernel::RunApi& api)
{
  if (flightControllerSub_ == nullptr)
  {
    // One typed interest on the drone bus: "SELECT drone_sim.FlightController FROM drone<ID>.bus". Opened
    // here, not in registered(): SEN runs registered() holding this object's bus lock (swarm.bus), and
    // opening another session's bus there can deadlock the process (lock order, ARCHITECTURE.md section 8). A drone-bus object
    // opens its subscriptions in registered().
    flightControllerSub_ = api.selectAllFrom<drone_sim::FlightControllerInterface>(getDroneBus());
  }

  // The subscription's list is this cycle's committed set of flight controllers on the bus (one, here).
  const auto& flightControllers = flightControllerSub_->list.getObjects();
  if (flightControllers.empty())
  {
    return;  // no flight controller (yet): keep publishing the last value
  }
  // flight_controller.state is one best-effort struct (position, attitude, mode, battery ...), committed
  // in one cycle, so never half-updated.
  setNextPosition(flightControllers.front()->getState().position);
}

drone_sim::CommandAck ExampleNodeImpl::setMessageImpl(const std::string& message)
{
  if (message.empty())
  {
    return {drone_sim::AckStatus::rejectedInvalid, "message must not be empty"};
  }
  setNextMessage(message);  // published with this cycle's commit
  return {drone_sim::AckStatus::accepted, ""};
}

// Mandatory, once per impl class, at the end of the .cpp: makes `example_node.ExampleNodeImpl`
// loadable from YAML. It is found by scanning the sources at CMake configure time, so after
// adding one re-run the configure step, not only the build.
SEN_EXPORT_CLASS(ExampleNodeImpl)

}  // namespace example_node
