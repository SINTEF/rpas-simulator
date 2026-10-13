// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#pragma once

// Kinematic fixed-wing flight model (sim_spec.md §5). Pure functions, plain doubles,
// NO SEN and no generated types — so it can be reasoned about and unit-tested on its own.
//
// Geometry, not physics: no forces, no torques, no PID, no substeps. Every cycle
//   * the bank angle moves toward a commanded bank at the roll rate,
//   * the course turns at the coordinated-turn rate g*tan(bank)/v,
//   * airspeed and climb rate move toward their targets within the acceleration limits,
//   * the position integrates course + speed + climb rate once.
// Attitude is then read off the motion: roll = bank, pitch = flight-path angle, yaw = course.
//
// Frame: north/east metres from the origin, altitude in metres AMSL.
// Angles are degrees, headings/courses clockwise from north.

#include <algorithm>
#include <cmath>

namespace airframe::kin
{

inline constexpr double kPi = 3.14159265358979323846;
inline constexpr double kRadiansPerDegree = kPi / 180.0;
inline constexpr double kG = 9.80665;

// Airframe limits. Defaults are a small tactical ISTAR fixed wing (hand/catapult launched);
// config/drone.yaml overrides them through FlightController statics.
struct Params
{
  double minSpeed = 12.0;     // m/s, stall-ish; airborne airspeed never goes below this
  double cruiseSpeed = 18.0;  // m/s, default command speed
  double maxSpeed = 25.0;     // m/s
  double maxAcceleration = 3.0;      // m/s^2, along-track in flight
  double launchAcceleration = 15.0;  // m/s^2 on the ground: catapult/hand-launch class, short run
  double maxBankDegrees = 35.0;   // coordinated-turn bank limit
  double rollRateDegreesPerSecond = 40.0;
  double maxFlightPathDegrees = 10.0;           // flight-path angle limit -> climb rate <= v*sin(fpa)
  double climbAcceleration = 1.5;           // m/s^2, how fast the climb rate changes
  double loiterRadiusM = 80.0;       // must be >= v^2/(g*tan(maxBank)); see minLoiterRadius()
  double bankPerCourseErrorDegrees = 3.0;  // commanded bank = gain * course error, clamped

  // Tightest coordinated turn radius at speed v — the loiter radius must not be smaller.
  double minLoiterRadius(double v) const { return (v * v) / (kG * std::tan(maxBankDegrees * kRadiansPerDegree)); }
};

// Everything that moves. `down` is not stored: altitude is AMSL.
struct State
{
  double north = 0.0;      // m from origin
  double east = 0.0;       // m from origin
  double altitude = 0.0;    // m
  double speed = 0.0;      // m/s, ground speed == airspeed (no wind yet)
  double courseDegrees = 0.0;  // direction of travel, deg CW from north
  double climbRate = 0.0;  // m/s, positive up
  double bankDegrees = 0.0;    // positive = right wing down
  bool onGround = true;
};

// What the flight controller asks of the airframe this cycle.
struct Command
{
  double courseDegrees = 0.0;  // where to point
  double speed = 20.0;     // target speed
  double climbRate = 0.0;  // target climb rate (clamped by the flight-path-angle limit)
  bool onGround = false;   // true: taxi/roll — wings level, no turning by bank, speed may reach 0
};

inline double normalizeDegrees(double d)
{
  d = std::fmod(d, 360.0);
  return d < 0.0 ? d + 360.0 : d;
}

// Shortest signed difference target - current, in the range -180 .. 180 deg.
inline double angleDiff(double currentDegrees, double targetDegrees)
{
  return std::fmod(targetDegrees - currentDegrees + 540.0, 360.0) - 180.0;
}

inline double clampAbs(double v, double limit) { return std::clamp(v, -limit, limit); }

// Move `value` toward `target` by at most `maxDelta`.
inline double approach(double value, double target, double maxDelta)
{
  const double d = target - value;
  return value + clampAbs(d, std::max(0.0, maxDelta));
}

// Course from one north/east point to another.
inline double courseTo(double fromN, double fromE, double toN, double toE)
{
  return normalizeDegrees(std::atan2(toE - fromE, toN - fromN) / kRadiansPerDegree);
}

inline double distanceTo(double fromN, double fromE, double toN, double toE)
{
  const double dn = toN - fromN;
  const double de = toE - fromE;
  return std::sqrt(dn * dn + de * de);
}

// Guidance for a right-hand (clockwise) loiter circle of radius `radius` around (cn, ce):
// fly the tangent, corrected toward or away from the circle by the radial error.
inline double loiterCourse(const State& s, double cn, double ce, double radius)
{
  const double d = distanceTo(cn, ce, s.north, s.east);
  const double bearingOut = courseTo(cn, ce, s.north, s.east);  // centre -> aircraft
  if (d < 1.0)
    return s.courseDegrees;  // (near) the centre: just keep flying, the error term takes over
  // +90 deg = clockwise tangent; +90 more = straight at the centre; -90 = straight outward.
  const double correction = clampAbs(90.0 * (d - radius) / std::max(radius, 1.0), 85.0);
  return normalizeDegrees(bearingOut + 90.0 + correction);
}

// One integration step. `dt` is sim seconds (already scaled by World.timeScale).
inline void step(State& s, const Command& command, const Params& p, double dt)
{
  if (dt <= 0.0)
    return;

  // --- speed ---------------------------------------------------------------------------------
  const double lo = command.onGround ? 0.0 : p.minSpeed;
  const double targetSpeed = std::clamp(command.speed, lo, p.maxSpeed);
  const double acceleration = command.onGround ? p.launchAcceleration : p.maxAcceleration;
  s.speed = std::clamp(approach(s.speed, targetSpeed, acceleration * dt), 0.0, p.maxSpeed);
  if (!command.onGround && s.speed < p.minSpeed)
    s.speed = p.minSpeed;  // airborne: never below minimum airspeed

  // --- bank and course -----------------------------------------------------------------------
  double wantBank = 0.0;
  if (!command.onGround)
    wantBank =
      clampAbs(p.bankPerCourseErrorDegrees * angleDiff(s.courseDegrees, command.courseDegrees), p.maxBankDegrees);
  s.bankDegrees = approach(s.bankDegrees, wantBank, p.rollRateDegreesPerSecond * dt);

  if (command.onGround)
  {
    // Ground roll: steer directly (nose wheel), no bank.
    s.courseDegrees =
      normalizeDegrees(s.courseDegrees + clampAbs(angleDiff(s.courseDegrees, command.courseDegrees), 30.0 * dt));
  }
  else
  {
    const double turnRateDegrees =
      (kG * std::tan(s.bankDegrees * kRadiansPerDegree) / std::max(s.speed, 1.0)) / kRadiansPerDegree;
    s.courseDegrees = normalizeDegrees(s.courseDegrees + turnRateDegrees * dt);
  }

  // --- climb rate ----------------------------------------------------------------------------
  const double maxClimb = command.onGround ? 0.0 : s.speed * std::sin(p.maxFlightPathDegrees * kRadiansPerDegree);
  s.climbRate = approach(s.climbRate, clampAbs(command.climbRate, maxClimb), p.climbAcceleration * dt);
  s.climbRate = clampAbs(s.climbRate, maxClimb);

  // --- integrate -----------------------------------------------------------------------------
  const double horizontalStep = s.speed * dt;
  s.north += horizontalStep * std::cos(s.courseDegrees * kRadiansPerDegree);
  s.east += horizontalStep * std::sin(s.courseDegrees * kRadiansPerDegree);
  s.altitude += s.climbRate * dt;
  s.onGround = command.onGround;
}

// Flight-path angle in degrees (pitch), positive nose-up.
inline double pitchDegrees(const State& s)
{
  if (s.speed < 0.1)
    return 0.0;
  return std::asin(clampAbs(s.climbRate / s.speed, 1.0)) / kRadiansPerDegree;
}

// Attitude as a quaternion (w, x, y, z) rotating body (x fwd, y right, z down) into NED.
// roll = bank, pitch = flight-path angle, yaw = course — attitude is pure geometry here.
inline void attitudeQuat(const State& s, double q[4])
{
  const double cr = std::cos(s.bankDegrees * kRadiansPerDegree * 0.5),
               sr = std::sin(s.bankDegrees * kRadiansPerDegree * 0.5);
  const double cp = std::cos(pitchDegrees(s) * kRadiansPerDegree * 0.5),
               sp = std::sin(pitchDegrees(s) * kRadiansPerDegree * 0.5);
  const double cy = std::cos(s.courseDegrees * kRadiansPerDegree * 0.5),
               sy = std::sin(s.courseDegrees * kRadiansPerDegree * 0.5);
  q[0] = cr * cp * cy + sr * sp * sy;
  q[1] = sr * cp * cy - cr * sp * sy;
  q[2] = cr * sp * cy + sr * cp * sy;
  q[3] = cr * cp * sy - sr * sp * cy;
}

// NED velocity (north, east, down) implied by the state.
inline void velocityNed(const State& s, double v[3])
{
  v[0] = s.speed * std::cos(s.courseDegrees * kRadiansPerDegree);
  v[1] = s.speed * std::sin(s.courseDegrees * kRadiansPerDegree);
  v[2] = -s.climbRate;
}

}  // namespace airframe::kin
