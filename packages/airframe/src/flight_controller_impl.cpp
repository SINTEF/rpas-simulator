// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#include "flight_controller_impl.h"

#include "geo.h"
#include "sen/core/base/assert.h"
#include "sen_helpers.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <string>

namespace airframe
{

using sen_helpers::first;

namespace
{
constexpr double kEnduranceS = 1800.0;    // battery 1.0 -> 0.0 in 30 min of armed flight
constexpr double kTouchdownM = 0.3;       // altitude above terrain that counts as on the ground
constexpr double kRollOutSpeed = 0.5;     // m/s below which the roll-out is finished
constexpr double kArriveMarginM = 2.0;    // climb-out is finished this close to the target altitude
constexpr double kDescentRate = 3.0;      // m/s sink rate on approach
constexpr double kAltitudeGain = 0.5;          // altitude-hold gain: climbRate = gain * altitude error
constexpr double kSpawnSpacingM = 150.0;  // drones without START_LATITUDE/LONGITUDE line up east of the origin
constexpr double kUnsetDegrees = 999.0;       // startLatitude/startLongitude sentinel (see airframe.stl)
constexpr double kMaxWallDtS = 1.0;       // a process stall (docker pause, loaded VM) is not flown through in one step

drone_sim::CommandAck ok(const char* what = "ok") { return {drone_sim::AckStatus::accepted, what}; }
drone_sim::CommandAck badState(const char* why) { return {drone_sim::AckStatus::rejectedState, why}; }
drone_sim::CommandAck badInput(const char* why) { return {drone_sim::AckStatus::rejectedInvalid, why}; }

bool airborneMode(drone_sim::FlightMode m)
{
  return m == drone_sim::FlightMode::takeoff || m == drone_sim::FlightMode::hold || m == drone_sim::FlightMode::goingTo;
}
}  // namespace

// --- FlightControllerImpl -----------------------------------------------------------------------

void FlightControllerImpl::registered(sen::kernel::RegistrationApi& api)
{
  drone_sim::VehicleState initial {};
  initial.attitude = drone_sim::Quaternion {1.0, 0.0, 0.0, 0.0};
  initial.mode = drone_sim::FlightMode::disarmed;
  initial.battery = battery_;
  setNextState(initial);
  applyStatics();  // throws on an unflyable config: SEN logs it and stops the process at startup

  worldSub_ = api.selectAllFrom<drone_sim::WorldInterface>(getSimBus());
}

// The envelope is a resolved contract value: it is taken as given, not merged with a default.
// It is checked for self-consistency all the same, together with the fixed-wing statics -- a config
// that cannot be flown (speeds out of order, a loiter circle tighter than the bank limit allows, an
// arrival radius inside the loiter circle) would otherwise show up as a drone
// that spirals or never arrives, far from the YAML line that caused it.
void FlightControllerImpl::applyStatics()
{
  const drone_sim::AirframeEnvelope& env = getEnvelope();
  params_.minSpeed = env.minSpeed;
  params_.cruiseSpeed = env.cruiseSpeed;
  params_.maxSpeed = env.maxSpeed;
  params_.maxBankDegrees = getMaxBankDegrees();  // the fixed-wing limits: SimAirframe statics, not the contract
  params_.maxFlightPathDegrees = getMaxFlightPathDegrees();
  params_.loiterRadiusM = getLoiterRadius();
  arrivalRadius_ = env.arrivalRadius;
  params_.launchAcceleration = getLaunchAcceleration();
  validateEnvelope();
}

// Refuse to start on an unflyable envelope, in one line naming the value and its flyable limit:
// never clamp, because the published envelope must be what is flown, and the navigator reaches a
// waypoint by arrivalRadius. Written as !(ok) so that NaN is refused too.
void FlightControllerImpl::validateEnvelope()
{
  const auto refuse = [this](const std::string& what)
  { sen::throwRuntimeError("flight_controller " + getDroneId() + ": envelope not flyable: " + what); };
  const kin::Params& p = params_;
  if (!(p.minSpeed >= 1.0))
    refuse("minSpeed " + std::to_string(p.minSpeed) + " m/s must be at least 1 m/s");
  if (!(p.maxSpeed >= p.minSpeed))
    refuse("maxSpeed " + std::to_string(p.maxSpeed) + " m/s must be at least minSpeed " + std::to_string(p.minSpeed));
  if (!(p.cruiseSpeed >= p.minSpeed && p.cruiseSpeed <= p.maxSpeed))
    refuse("cruiseSpeed " + std::to_string(p.cruiseSpeed) + " m/s must lie in [minSpeed, maxSpeed] = ["
           + std::to_string(p.minSpeed) + ", " + std::to_string(p.maxSpeed) + "]");
  if (!(p.maxBankDegrees >= 1.0 && p.maxBankDegrees <= 79.0))
    refuse("maxBankDegrees " + std::to_string(p.maxBankDegrees) + " must lie in [1, 79]");
  if (!(p.loiterRadiusM >= p.minLoiterRadius(p.cruiseSpeed)))
    refuse("loiterRadius " + std::to_string(p.loiterRadiusM) + " m must be at least "
           + std::to_string(p.minLoiterRadius(p.cruiseSpeed)) + " m (tightest turn at cruise)");
  if (!(arrivalRadius_ > p.loiterRadiusM))
    refuse("arrivalRadius " + std::to_string(arrivalRadius_) + " m must be greater than loiterRadius "
           + std::to_string(p.loiterRadiusM) + " m");
}

// The origin is only known once the world object has been discovered, so placement waits for it.
void FlightControllerImpl::initFromWorld(const drone_sim::WorldInterface& world)
{
  origin_ = world.getOrigin();
  groundAltitude_ = origin_.altitude.get();

  double latitude = getStartLatitude();  // the START_LATITUDE / START_LONGITUDE statics (@env() in the YAML)
  double longitude = getStartLongitude();
  if (latitude == kUnsetDegrees || longitude == kUnsetDegrees || !std::isfinite(latitude) || !std::isfinite(longitude))
  {
    // No explicit start position: park drone <n> n-1 spacings east of the origin, nose north.
    const int index = std::max(0, std::atoi(getDroneId().c_str()) - 1);
    const drone_sim::GeoPosition p = geo::nedToGeo(origin_, 0.0, index * kSpawnSpacingM, groundAltitude_);
    latitude = p.latitude.get();
    longitude = p.longitude.get();
  }

  const drone_sim::GeoPosition start {
    drone_sim::Latitude {latitude}, drone_sim::Longitude {longitude}, drone_sim::Altitude {groundAltitude_}};
  setNextHomePosition(start);  // published once: the datum every AGL number on the drone bus refers to
  geo::geoToNed(origin_, start, state_.north, state_.east);
  state_.altitude = groundAltitude_;
  state_.courseDegrees = 0.0;  // parked facing north
  state_.onGround = true;

  placed_ = true;
}

// A goToPosition / setVelocity / land that arrived during the launch run: honour it now that the
// vehicle is flying, instead of having accelerated it from 0 to minSpeed on the ground.
void FlightControllerImpl::applyPending()
{
  switch (pending_)
  {
    case Pending::none:
      break;
    case Pending::goToPosition:
      holdN_ = pendingN_;
      holdE_ = pendingE_;
      targetAltitude_ = pendingAltitude_;
      targetSpeed_ = pendingSpeed_;
      velocityCommand_ = false;
      mode_ = drone_sim::FlightMode::goingTo;
      break;
    case Pending::setVelocity:
      commandedCourse_ = pendingCourse_;
      commandedClimbRate_ = pendingClimb_;
      targetSpeed_ = pendingSpeed_;
      velocityCommand_ = true;
      mode_ = drone_sim::FlightMode::goingTo;
      break;
    case Pending::land:
      mode_ = drone_sim::FlightMode::land;
      break;
  }
  pending_ = Pending::none;
}

// Motors off for good: guide() glides it down (or stops it on the ground), every command is refused.
void FlightControllerImpl::crash()
{
  mode_ = drone_sim::FlightMode::crashed;
  pending_ = Pending::none;
  velocityCommand_ = false;
}

// Mode logic: turn the current mode and its targets into what the airframe is asked to fly.
void FlightControllerImpl::guide(kin::Command& command)
{
  command.courseDegrees = state_.courseDegrees;
  command.speed = 0.0;
  command.climbRate = 0.0;
  command.onGround = true;

  const double altitudeHoldClimbRate = kAltitudeGain * (targetAltitude_ - state_.altitude);

  switch (mode_)
  {
    case drone_sim::FlightMode::disarmed:
    case drone_sim::FlightMode::armed:
      break;  // parked

    case drone_sim::FlightMode::takeoff:
      if (state_.speed < params_.minSpeed && state_.altitude <= groundAltitude_ + kTouchdownM)
      {
        command.speed = params_.maxSpeed;  // launch run on the current heading (launchAcceleration: short)
      }
      else
      {
        command.onGround = false;
        command.speed = params_.cruiseSpeed;
        command.climbRate = 1e3;  // "as fast as you can": step() clamps it to the flight-path-angle limit
        if (state_.altitude >= targetAltitude_ - kArriveMarginM)
        {
          mode_ = drone_sim::FlightMode::hold;  // climb-out done: loiter where we are
          holdN_ = state_.north;
          holdE_ = state_.east;
          targetSpeed_ = params_.cruiseSpeed;
        }
      }
      break;

    case drone_sim::FlightMode::hold:
      command.onGround = false;
      command.speed = targetSpeed_;
      command.climbRate = altitudeHoldClimbRate;
      command.courseDegrees = kin::loiterCourse(state_, holdN_, holdE_, params_.loiterRadiusM);
      break;

    case drone_sim::FlightMode::goingTo:
      command.onGround = false;
      if (velocityCommand_)
      {
        command.courseDegrees = commandedCourse_;
        command.speed = targetSpeed_;
        command.climbRate = commandedClimbRate_;
      }
      else if (kin::distanceTo(state_.north, state_.east, holdN_, holdE_) <= arrivalRadius_)
      {
        mode_ = drone_sim::FlightMode::hold;  // arrived: a fixed wing cannot stop, so loiter around it
        // Loiter at cruise: the turn radius at maxSpeed would not fit in the loiter radius.
        targetSpeed_ = params_.cruiseSpeed;
        command.speed = targetSpeed_;
        command.climbRate = altitudeHoldClimbRate;
        command.courseDegrees = kin::loiterCourse(state_, holdN_, holdE_, params_.loiterRadiusM);
      }
      else
      {
        command.speed = targetSpeed_;
        command.climbRate = altitudeHoldClimbRate;
        command.courseDegrees = kin::courseTo(state_.north, state_.east, holdN_, holdE_);
      }
      break;

    case drone_sim::FlightMode::land:
      if (state_.altitude > groundAltitude_ + kTouchdownM)
      {
        command.onGround = false;  // descend on the current course at minimum airspeed
        command.speed = params_.minSpeed;
        command.climbRate = -kDescentRate;
      }
      else if (state_.speed > kRollOutSpeed)
      {
        state_.altitude = groundAltitude_;  // touched down: roll out to a stop
      }
      else
      {
        state_.altitude = groundAltitude_;
        state_.speed = 0.0;
        mode_ = drone_sim::FlightMode::disarmed;
      }
      break;

    case drone_sim::FlightMode::crashed:
      if (state_.altitude > groundAltitude_ + kTouchdownM)
      {
        // Motors off: wings level on the current course at minimum airspeed, sinking as steeply as
        // the flight-path-angle limit lets it (a glide).
        command.onGround = false;
        command.speed = params_.minSpeed;
        command.climbRate = -1e3;
      }
      else
      {
        state_.altitude = groundAltitude_;  // on the ground: lies still
        state_.speed = 0.0;
        state_.climbRate = 0.0;
        state_.bankDegrees = 0.0;
      }
      break;
  }
}

void FlightControllerImpl::update(sen::kernel::RunApi& api)
{
  const drone_sim::WorldInterface* world = first(worldSub_);
  if (world == nullptr)
  {
    lastTick_.reset();  // no origin yet, or the world is gone (Reset): do not integrate the gap when it returns
    worldSimTime_.reset();  // and take the stamp from its first value
    return;
  }
  const double cycleTime = api.getTargetCycleTime().value().toSeconds();
  if (!placed_)
  {
    // The model always steps at the component frequency; it only PUBLISHES at publishRate. 50 Hz of
    // state on the buses is what kills the ether once several drones are up.
    const double rate = getPublishRate();
    publishEvery_ = std::max(1, static_cast<int>(std::lround(1.0 / (rate * std::max(cycleTime, 1e-6)))));
    initFromWorld(*world);
  }

  // Integrate the MEASURED api.getTime() delta x timeScale — the same base as world.simTime — so
  // motion and the clock agree under load and at high time scales. The first
  // cycle has no previous tick and uses the nominal cycle time; capped at kMaxWallDtS like the ground assets.
  const sen::TimeStamp now = api.getTime();
  const double wallDt = std::min(kMaxWallDtS, lastTick_ ? (now - *lastTick_).toSeconds() : cycleTime);
  lastTick_ = now;
  const double dt = world->getPaused() ? 0.0 : wallDt * world->getTimeScale();
  // The stamp: world.simTime arrives at 10 Hz while the model steps at 50 Hz (at 100x a world cycle
  // is 10 s of simulation). Each new value is the world's time when it was sent; every step adds its
  // dt, as in the ground assets. A world that stalls is flown through and stamped; its next value
  // takes over.
  if (worldSimTime_ != world->getSimTime())
  {
    worldSimTime_ = world->getSimTime();
    stateTime_ = *worldSimTime_;
  }
  stateTime_ += dt;

  if (pending_ != Pending::none && !state_.onGround)
  {
    applyPending();
  }

  if (dt > 0.0)
  {
    kin::Command command;
    guide(command);
    kin::step(state_, command, params_, dt);
    if (state_.altitude < groundAltitude_)
    {
      state_.altitude = groundAltitude_;  // flat terrain
      if (mode_ == drone_sim::FlightMode::hold || mode_ == drone_sim::FlightMode::goingTo)
      {
        crash();  // flown into the ground (e.g. setVelocity with a sink rate): only land touches down
      }
    }
    if (mode_ != drone_sim::FlightMode::disarmed && mode_ != drone_sim::FlightMode::crashed)
    {
      battery_ = std::max(0.0, battery_ - dt / kEnduranceS);
      if (battery_ <= 0.0)
      {
        // Empty: in the air the motors stop and it comes down; on the ground it just shuts down.
        if (state_.onGround)
        {
          mode_ = drone_sim::FlightMode::disarmed;
          pending_ = Pending::none;
        }
        else
        {
          crash();
        }
      }
    }
  }

  // Publish every n-th cycle (dt for the body rates is the time since the last publication).
  sinceTime_ += dt;
  if (++sinceCount_ >= publishEvery_)
  {
    publish(stateTime_, sinceTime_);
    sinceCount_ = 0;
    sinceTime_ = 0.0;
  }
}

void FlightControllerImpl::publish(double simTime, double dt)
{
  double q[4] = {1.0, 0.0, 0.0, 0.0};
  kin::attitudeQuat(state_, q);
  double v[3] = {0.0, 0.0, 0.0};
  kin::velocityNed(state_, v);

  // Euler rates by finite difference of roll/pitch/yaw (good enough: attitude is geometry here),
  // then the standard Euler -> body transform, because bodyRates is p, q, r about the body axes.
  const double rollPitchYaw[3] = {state_.bankDegrees * kin::kRadiansPerDegree,
                                  kin::pitchDegrees(state_) * kin::kRadiansPerDegree,
                                  state_.courseDegrees * kin::kRadiansPerDegree};
  double euler[3] = {0.0, 0.0, 0.0};  // phiDot, thetaDot, psiDot in rad/s
  if (dt > 0.0)
  {
    for (int i = 0; i < 3; ++i)
    {
      double d = rollPitchYaw[i] - lastRollPitchYaw_[i];
      while (d > kin::kPi)
      {
        d -= 2.0 * kin::kPi;
      }
      while (d < -kin::kPi)
      {
        d += 2.0 * kin::kPi;
      }
      euler[i] = d / dt;
    }
  }
  lastRollPitchYaw_[0] = rollPitchYaw[0];
  lastRollPitchYaw_[1] = rollPitchYaw[1];
  lastRollPitchYaw_[2] = rollPitchYaw[2];

  const double sphi = std::sin(rollPitchYaw[0]), cphi = std::cos(rollPitchYaw[0]);
  const double sth = std::sin(rollPitchYaw[1]), cth = std::cos(rollPitchYaw[1]);
  const drone_sim::Vec3 rates {euler[0] - euler[2] * sth,
                          euler[1] * cphi + euler[2] * cth * sphi,
                          -euler[1] * sphi + euler[2] * cth * cphi};

  // One snapshot, published as one best-effort property (committed in one cycle, never half-updated). The derived fields are computed here,
  // once, so that every consumer sees the same numbers (sim_spec.md section 14).
  drone_sim::VehicleState s;
  s.position = geo::nedToGeo(origin_, state_.north, state_.east, state_.altitude);
  s.velocity = drone_sim::Vec3 {v[0], v[1], v[2]};
  s.attitude = drone_sim::Quaternion {q[0], q[1], q[2], q[3]};
  s.bodyRates = rates;
  // Nose heading is the yaw of the attitude; course is the direction of the horizontal velocity.
  // The model has no wind and no sideslip, so it flies where it points and the two numbers agree.
  s.heading = kin::normalizeDegrees(state_.courseDegrees);
  s.groundSpeed = std::sqrt(v[0] * v[0] + v[1] * v[1]);
  // Standing still there is no track: report the nose heading rather than atan2(0, 0).
  s.course = s.groundSpeed < 1e-3 ? s.heading : kin::normalizeDegrees(std::atan2(v[1], v[0]) / kin::kRadiansPerDegree);
  s.verticalSpeed = -v[2];
  s.mode = mode_;
  s.battery = battery_;
  s.stateTime = simTime;

  setNextState(s);
}

// --- commands -----------------------------------------------------------------------------------
// These run during drain. They validate against the current mode and set plain members only.

drone_sim::CommandAck FlightControllerImpl::armImpl()
{
  if (mode_ == drone_sim::FlightMode::crashed)
  {
    return badState("crashed");
  }
  if (!placed_)
  {
    return badState("airframe not initialised (no world yet)");
  }
  if (mode_ != drone_sim::FlightMode::disarmed)
  {
    return badState("already armed");
  }
  if (battery_ <= 0.0)
  {
    return badState("battery empty");
  }
  mode_ = drone_sim::FlightMode::armed;
  return ok();
}

drone_sim::CommandAck FlightControllerImpl::disarmImpl()
{
  if (mode_ == drone_sim::FlightMode::crashed)
  {
    return badState("crashed");
  }
  if (mode_ == drone_sim::FlightMode::disarmed)
  {
    return ok();
  }
  if (mode_ != drone_sim::FlightMode::armed)
  {
    return badState("cannot disarm in flight");
  }
  mode_ = drone_sim::FlightMode::disarmed;
  return ok();
}

drone_sim::CommandAck FlightControllerImpl::takeoffImpl(double altitudeAboveGround)
{
  if (mode_ == drone_sim::FlightMode::crashed)
  {
    return badState("crashed");
  }
  if (mode_ != drone_sim::FlightMode::armed)
  {
    return badState("takeoff requires mode armed");
  }
  if (!std::isfinite(altitudeAboveGround) || altitudeAboveGround < 5.0 || altitudeAboveGround > 10000.0)
  {
    return badInput("takeoff altitude must be 5..10000 m AGL");
  }
  targetAltitude_ =
    groundAltitude_ + altitudeAboveGround;  // above homePosition.altitude (flat terrain: the origin altitude)
  targetSpeed_ = params_.cruiseSpeed;
  velocityCommand_ = false;
  pending_ = Pending::none;
  mode_ = drone_sim::FlightMode::takeoff;
  return ok();
}

drone_sim::CommandAck FlightControllerImpl::landImpl()
{
  if (mode_ == drone_sim::FlightMode::crashed)
  {
    return badState("crashed");
  }
  if (!airborneMode(mode_))
  {
    return badState("land requires being airborne");
  }
  if (state_.onGround)
  {
    pending_ = Pending::land;  // still on the launch run: land once it is actually flying
    return ok("queued until airborne");
  }
  mode_ = drone_sim::FlightMode::land;
  return ok();
}

drone_sim::CommandAck FlightControllerImpl::goToPositionImpl(const drone_sim::GeoPosition& target, double speed)
{
  if (mode_ == drone_sim::FlightMode::crashed)
  {
    return badState("crashed");
  }
  if (!airborneMode(mode_))
  {
    return badState("goToPosition requires being airborne");
  }
  const double latitude = target.latitude.get();
  const double longitude = target.longitude.get();
  const double altitude = target.altitude.get();
  if (!std::isfinite(latitude) || !std::isfinite(longitude) || !std::isfinite(altitude) || !std::isfinite(speed))
  {
    return badInput("target and speed must be finite");
  }
  double north = 0.0;
  double east = 0.0;
  geo::geoToNed(origin_, target, north, east);
  // Altitude and speed are clamped to what a fixed wing can do rather than rejected.
  const double wantAltitude = std::max(altitude, groundAltitude_ + 10.0);
  const double wantSpeed = speed <= 0.0 ? params_.cruiseSpeed : std::clamp(speed, params_.minSpeed, params_.maxSpeed);

  if (state_.onGround)
  {
    // Still rolling: taking the command now would jump the ground speed to minSpeed.
    pending_ = Pending::goToPosition;
    pendingN_ = north;
    pendingE_ = east;
    pendingAltitude_ = wantAltitude;
    pendingSpeed_ = wantSpeed;
    return ok("queued until airborne");
  }

  holdN_ = north;
  holdE_ = east;
  targetAltitude_ = wantAltitude;
  targetSpeed_ = wantSpeed;
  velocityCommand_ = false;
  mode_ = drone_sim::FlightMode::goingTo;
  return ok();
}

drone_sim::CommandAck FlightControllerImpl::setVelocityImpl(const drone_sim::Vec3& v)
{
  if (mode_ == drone_sim::FlightMode::crashed)
  {
    return badState("crashed");
  }
  if (!airborneMode(mode_))
  {
    return badState("setVelocity requires being airborne");
  }
  if (!std::isfinite(v[0]) || !std::isfinite(v[1]) || !std::isfinite(v[2]))
  {
    return badInput("velocity must be finite");
  }
  const double ground = std::sqrt(v[0] * v[0] + v[1] * v[1]);
  if (ground < 1e-3)
  {
    return badInput("a fixed wing cannot fly at zero ground speed");
  }
  const double course = kin::normalizeDegrees(std::atan2(v[1], v[0]) / kin::kRadiansPerDegree);
  const double wantSpeed = std::clamp(ground, params_.minSpeed, params_.maxSpeed);
  const double climb = -v[2];  // NED down -> climb rate

  if (state_.onGround)
  {
    pending_ = Pending::setVelocity;
    pendingCourse_ = course;
    pendingClimb_ = climb;
    pendingSpeed_ = wantSpeed;
    return ok("queued until airborne");
  }

  commandedCourse_ = course;
  targetSpeed_ = wantSpeed;
  commandedClimbRate_ = climb;
  velocityCommand_ = true;
  mode_ = drone_sim::FlightMode::goingTo;
  return ok();
}

SEN_EXPORT_CLASS(FlightControllerImpl)

}  // namespace airframe
