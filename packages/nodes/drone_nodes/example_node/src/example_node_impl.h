// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#pragma once

#include "sen/core/obj/subscription.h"
#include "sen/kernel/component_api.h"
#include "stl/drone_sim/drone_bus/flight_controller.stl.h"
#include "stl/drone_sim/nodes/example_node.stl.h"

#include <memory>
#include <string>

// The namespace MUST equal the package TARGET name in CMakeLists.txt: the generated export
// table looks for example_node::senExportExampleNodeImpl.
namespace example_node
{

// swarm.bus/example_drone<ID>: the template node. Reads the flight controller on its drone bus, publishes
// its position, and takes setMessage() calls over the air. Copy, rename, replace the bodies.
class ExampleNodeImpl: public drone_sim::ExampleNodeBase
{
public:
  SEN_NOCOPY_NOMOVE(ExampleNodeImpl)

  using drone_sim::ExampleNodeBase::ExampleNodeBase;  // the YAML factory constructor (statics from config)
  ~ExampleNodeImpl() override = default;

  // Called once, on the bus, before the first update(): initial values go here.
  void registered(sen::kernel::RegistrationApi& api) override;
  // Called every cycle of the component this object is loaded into (freqHz in the YAML).
  void update(sen::kernel::RunApi& api) override;

protected:
  // Runs when a call arrives (during the cycle's drain, same thread as update()).
  drone_sim::CommandAck setMessageImpl(const std::string& message) override;

private:
  // A peer on the bus is a subscription: its `list` is the current set of matching objects, read
  // where it is used (update()). It must be a MEMBER: a local one is destroyed at the end of the
  // scope and the list silently stays empty.
  std::shared_ptr<sen::Subscription<drone_sim::FlightControllerInterface>> flightControllerSub_;
};

}  // namespace example_node
