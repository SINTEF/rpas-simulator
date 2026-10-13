// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#pragma once

#include "kinematics.h"
#include "sen/core/base/timestamp.h"
#include "sen/core/obj/subscription.h"
#include "sen/kernel/component_api.h"
#include "stl/drone_sim/sim/airframe.stl.h"
#include "stl/drone_sim/sim_bus/world.stl.h"

#include <memory>
#include <optional>
#include <string>

namespace airframe
{

// drone<ID>.bus/flight_controller: the flight controller and the kinematic fixed-wing airframe behind it.
// Implements drone_sim.SimAirframe, which is drone_sim.FlightController (the partner-facing contract) plus the
// simulator-only statics (fixed-wing limits included); on-board software only ever sees the FlightController half.
//
// Steps at airframeComponent freqHz (50 Hz) with dt = cycleTime x World.timeScale, frozen while
// World.paused, and publishes at publishRate (10 Hz). Mode logic (see airframe.stl for the fixed-wing
// realisation of each command):
//   disarmed  on the ground, no motion
//   armed     on the ground, ready
//   takeoff   launch run on the current heading to min airspeed, then climb-out -> hold
//   hold      loiter circle around the hold point at the hold altitude
//   goingTo   fly to the target (or a commanded velocity), then loiter there -> hold
//   land      descend on the current course, touch down, roll out -> disarmed
//   crashed   battery 0 in the air: motors off, wings-level glide to the ground, then still; refuses
//             every command (battery 0 on the ground -> disarmed)
class FlightControllerImpl: public drone_sim::SimAirframeBase<drone_sim::FlightControllerBase>
{
public:
  SEN_NOCOPY_NOMOVE(FlightControllerImpl)

  using drone_sim::SimAirframeBase<drone_sim::FlightControllerBase>::SimAirframeBase;
  ~FlightControllerImpl() override = default;

  void registered(sen::kernel::RegistrationApi& api) override;
  void update(sen::kernel::RunApi& api) override;

protected:
  // Command methods run during drain: they validate against the committed state and only touch
  // plain members; every property is staged in update().
  drone_sim::CommandAck armImpl() override;
  drone_sim::CommandAck disarmImpl() override;
  drone_sim::CommandAck takeoffImpl(double altitudeAboveGround) override;
  drone_sim::CommandAck landImpl() override;
  drone_sim::CommandAck goToPositionImpl(const drone_sim::GeoPosition& target, double speed) override;
  drone_sim::CommandAck setVelocityImpl(const drone_sim::Vec3& v) override;

private:
  // A command that arrived during the launch run: valid, but the vehicle is not airborne yet, so
  // it is held here and applied the moment it is (see applyPending()).
  enum class Pending
  {
    none,
    goToPosition,
    setVelocity,
    land
  };

  void applyStatics();      // envelope + fixed-wing limits from the YAML statics
  void validateEnvelope();  // refuse an unflyable envelope (throw, never clamp); throw if arrivalRadius <= the hold circle
  // Place the airframe once the world (origin) is known.
  void initFromWorld(const drone_sim::WorldInterface& world);
  void applyPending();            // hand a queued command over once airborne
  void crash();                   // mode crashed: motors off, queued and velocity commands dropped
  void guide(kin::Command& command);  // mode logic -> what the airframe is asked to do
  void publish(double simTime, double dt);

  // World (origin, timeScale, paused) -- one cycle of lag is accepted.
  std::shared_ptr<sen::Subscription<drone_sim::WorldInterface>> worldSub_;

  bool placed_ = false;
  int publishEvery_ = 1;  // publish every n-th cycle: freqHz steps, publishRate publications
  int sinceCount_ = 0;
  double sinceTime_ = 0.0;  // sim seconds accumulated since the last publication
  std::optional<sen::TimeStamp> lastTick_;  // api.getTime() of the previous update (dt base); none before the first
  std::optional<double> worldSimTime_;  // the last world.simTime received
  double stateTime_ = 0.0;  // that value advanced by every step since: the stamp of the state flown
  drone_sim::GeoPosition origin_ {};
  double groundAltitude_ = 0.0;  // flat terrain = origin altitude

  kin::Params params_ {};
  double arrivalRadius_ = 0.0;  // envelope.arrivalRadius as flown (validated): goingTo -> hold inside it
  kin::State state_ {};
  double battery_ = 1.0;
  drone_sim::FlightMode mode_ = drone_sim::FlightMode::disarmed;

  // Guidance targets set by the command methods.
  double targetAltitude_ = 0.0;    // takeoff / hold / goto altitude, m AMSL
  double targetSpeed_ = 0.0;  // commanded speed, m/s
  double holdN_ = 0.0;        // loiter centre, m from origin
  double holdE_ = 0.0;
  bool velocityCommand_ = false;  // goingTo flavour: follow a velocity setpoint, not a point
  double commandedCourse_ = 0.0;    // velocity setpoint: course / climb rate
  double commandedClimbRate_ = 0.0;

  Pending pending_ = Pending::none;
  double pendingN_ = 0.0;
  double pendingE_ = 0.0;
  double pendingAltitude_ = 0.0;
  double pendingSpeed_ = 0.0;
  double pendingCourse_ = 0.0;
  double pendingClimb_ = 0.0;

  // Previous roll/pitch/yaw in radians, for the finite-difference body rates.
  double lastRollPitchYaw_[3] = {0.0, 0.0, 0.0};
};

}  // namespace airframe
