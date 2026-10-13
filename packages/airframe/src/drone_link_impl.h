// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#pragma once

#include "sen/core/obj/subscription.h"
#include "sen/kernel/component_api.h"
#include "stl/drone_sim/sim/airframe.stl.h"
#include "stl/drone_sim/swarm_bus/drone_link.stl.h"

#include <future>
#include <memory>
#include <optional>

namespace airframe
{

// swarm.bus/drone<ID>: the vehicle's public face, a YAML object of the airframe component built like
// DroneTruthImpl. Subscribes to flight_controller on droneBus (the
// same query as the truth mirror), republishes its state and envelope, counts its own heartbeat, and forwards the six
// flight-controller commands. flight_controller itself stays off the shared bus.
class DroneLinkImpl: public drone_sim::SimDroneLinkBase<drone_sim::DroneLinkBase>
{
public:
  SEN_NOCOPY_NOMOVE(DroneLinkImpl)

  using drone_sim::SimDroneLinkBase<drone_sim::DroneLinkBase>::SimDroneLinkBase;
  ~DroneLinkImpl() override = default;

  void update(sen::kernel::RunApi& api) override;

protected:
  // Deferred commands (interfaces/codegen_settings.json): each one is forwarded to the flight
  // controller and the ack the caller gets is the flight controller's own, delivered a cycle or two later.
  void armImpl(std::promise<drone_sim::CommandAck>&& promise) override;
  void disarmImpl(std::promise<drone_sim::CommandAck>&& promise) override;
  void takeoffImpl(double altitudeAboveGround, std::promise<drone_sim::CommandAck>&& promise) override;
  void landImpl(std::promise<drone_sim::CommandAck>&& promise) override;
  void goToPositionImpl(const drone_sim::GeoPosition& target,
                        double speed,
                        std::promise<drone_sim::CommandAck>&& promise) override;
  void setVelocityImpl(const drone_sim::Vec3& velocity, std::promise<drone_sim::CommandAck>&& promise) override;

private:
  // The flight controller, or nullptr after answering the promise with rejectedUnavailable.
  drone_sim::FlightControllerInterface* flightControllerOr(std::promise<drone_sim::CommandAck>& promise);

  std::shared_ptr<sen::Subscription<drone_sim::FlightControllerInterface>> flightControllerSub_;
  std::optional<sen::TimeStamp> lastBeat_;  // when heartbeat last advanced
};

}  // namespace airframe
