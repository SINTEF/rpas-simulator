// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#include "ground_asset_impl.h"

#include "geo.h"
#include "sen_helpers.h"

#include <algorithm>

namespace world
{

using sen_helpers::first;

namespace
{
constexpr double kMinReachM = 3.0;  // capture radius at rest / low speed
constexpr double kMaxWallDtS = 1.0;  // a process stall (docker pause, loaded VM) is not driven through

double maxTurnRateDegPerS(drone_sim::AssetType type) { return type == drone_sim::AssetType::truck ? 45.0 : 30.0; }
}  // namespace

void GroundAssetImpl::registered(sen::kernel::RegistrationApi& api)
{
  const auto& wps = getWaypoints();
  if (!wps.empty())
  {
    position_ = wps[0];
    target_ = wps.size() > 1 ? 1 : 0;
    heading_ = wps.size() > 1 ? geo::bearingDegrees(wps[0], wps[1]) : 0.0;
  }
  setNextPosition(position_);
  setNextHeading(heading_);
  setNextStateTime(0.0);

  // Same component and process as world; the list holds it from the first cycle on.
  worldSub_ = api.selectAllFrom<drone_sim::WorldInterface>(getSimBus());
}

void GroundAssetImpl::update(sen::kernel::RunApi& api)
{
  // Measured api.getTime() delta x timeScale, the same base as world.simTime;
  // the first cycle uses the nominal cycle time. The tick is taken every cycle, also while
  // paused, so un-pausing does not integrate the pause. Capped at kMaxWallDtS: after a process
  // stall the whole gap would otherwise be driven in one straight step, kilometres off the route.
  const sen::TimeStamp now = api.getTime();
  const double wallDt = std::min(
    kMaxWallDtS, lastTick_ ? (now - *lastTick_).toSeconds() : api.getTargetCycleTime().value().toSeconds());
  lastTick_ = now;

  const auto& wps = getWaypoints();
  const drone_sim::WorldInterface* world = first(worldSub_);
  if (world == nullptr || wps.size() < 2 || world->getPaused())
    return;

  const double dt = wallDt * world->getTimeScale();
  if (dt <= 0.0)
    return;

  // Switch waypoint when close, then steer toward it with a turn-rate limit and drive along
  // heading. The capture radius has to grow with the step length: at a high time scale the asset
  // covers tens of metres per cycle and a fixed 3 m radius is jumped straight over, after which
  // the asset circles its waypoint forever (seen at 10x).
  const double reachM = std::max(kMinReachM, 1.5 * getSpeed() * dt);
  if (geo::horizontalDistance(position_, wps[target_]) < reachM)
    target_ = (target_ + 1) % wps.size();
  const double want = geo::bearingDegrees(position_, wps[target_]);
  heading_ = geo::normalizeHeading(heading_ + geo::turnToward(heading_, want, maxTurnRateDegPerS(getAssetType()) * dt));
  position_ = geo::destinationPoint(position_, heading_, getSpeed() * dt);

  setNextPosition(position_);
  setNextHeading(heading_);
  // The world's simTime read here is its last commit, one cycle old; this cycle's step completes it.
  setNextStateTime(world->getSimTime() + dt);
}

SEN_EXPORT_CLASS(GroundAssetImpl)

}  // namespace world
