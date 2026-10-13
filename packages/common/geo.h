// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#pragma once

// Flat-earth helpers around the origin (pure functions, no SEN).
// Ported from drone_sim_v3 packages/drone_sim/src/geo.h.
// Shared by the world and airframe packages via `DEPS drone_sim_common` (packages/common/).

#include "stl/drone_sim/common/types.stl.h"

#include <cmath>

namespace geo
{

constexpr double kPi = 3.14159265358979323846;
constexpr double kDegreesToRadians = kPi / 180.0;
constexpr double kRadiansToDegrees = 180.0 / kPi;
constexpr double kMetersPerDegreeLatitude = 111320.0;

inline double horizontalDistance(const drone_sim::GeoPosition& a, const drone_sim::GeoPosition& b)
{
  const double north = (b.latitude.get() - a.latitude.get()) * kMetersPerDegreeLatitude;
  const double east =
    (b.longitude.get() - a.longitude.get()) * kMetersPerDegreeLatitude * std::cos(a.latitude.get() * kDegreesToRadians);
  return std::sqrt(north * north + east * east);
}

// Bearing from -> to, deg CW from north, 0 <= b < 360.
inline double bearingDegrees(const drone_sim::GeoPosition& from, const drone_sim::GeoPosition& to)
{
  const double north = to.latitude.get() - from.latitude.get();
  const double east = (to.longitude.get() - from.longitude.get()) * std::cos(from.latitude.get() * kDegreesToRadians);
  double degrees = std::atan2(east, north) * kRadiansToDegrees;
  if (degrees < 0.0)
    degrees += 360.0;
  return degrees;
}

inline double normalizeHeading(double degrees)
{
  degrees = std::fmod(degrees, 360.0);
  if (degrees < 0.0)
    degrees += 360.0;
  return degrees;
}

// Shortest signed turn from currentDegrees toward targetDegrees, clamped to +-maxTurnDegrees.
inline double turnToward(double currentDegrees, double targetDegrees, double maxTurnDegrees)
{
  double turn = std::fmod(targetDegrees - currentDegrees + 540.0, 360.0) - 180.0;
  if (turn > maxTurnDegrees)
    turn = maxTurnDegrees;
  if (turn < -maxTurnDegrees)
    turn = -maxTurnDegrees;
  return turn;
}

// The point `distance` metres from `position` along `bearing` (deg CW from north), altitude unchanged.
inline drone_sim::GeoPosition destinationPoint(const drone_sim::GeoPosition& position, double bearing, double distance)
{
  const double bearingRadians = bearing * kDegreesToRadians;
  const double latitude = position.latitude.get() + distance * std::cos(bearingRadians) / kMetersPerDegreeLatitude;
  const double cosLatitude = std::cos(latitude * kDegreesToRadians);
  double longitude = position.longitude.get();
  if (cosLatitude > 1e-10)
    longitude += distance * std::sin(bearingRadians) / (kMetersPerDegreeLatitude * cosLatitude);
  return drone_sim::GeoPosition {drone_sim::Latitude {latitude}, drone_sim::Longitude {longitude}, position.altitude};
}

// --- flat-earth NED around the origin ----------------------------------------------------

// Position `position` as north/east metres from `origin`.
inline void geoToNed(const drone_sim::GeoPosition& origin,
                     const drone_sim::GeoPosition& position,
                     double& north,
                     double& east)
{
  north = (position.latitude.get() - origin.latitude.get()) * kMetersPerDegreeLatitude;
  east = (position.longitude.get() - origin.longitude.get()) * kMetersPerDegreeLatitude *
         std::cos(origin.latitude.get() * kDegreesToRadians);
}

// North/east metres from `origin` plus an absolute altitude (m AMSL) back to lat/lon.
inline drone_sim::GeoPosition nedToGeo(const drone_sim::GeoPosition& origin, double north, double east, double altitude)
{
  const double latitude = origin.latitude.get() + north / kMetersPerDegreeLatitude;
  const double cosLatitude = std::cos(origin.latitude.get() * kDegreesToRadians);
  double longitude = origin.longitude.get();
  if (cosLatitude > 1e-10)
    longitude += east / (kMetersPerDegreeLatitude * cosLatitude);
  return drone_sim::GeoPosition {drone_sim::Latitude {latitude}, drone_sim::Longitude {longitude},
                                 drone_sim::Altitude {altitude}};
}

}  // namespace geo
