// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#include "world_impl.h"

#include <cmath>

namespace world
{

namespace
{
constexpr double kMinTimeScale = 0.05;
constexpr double kMaxTimeScale = 100.0;
}  // namespace

void WorldImpl::registered(sen::kernel::RegistrationApi& /*api*/)
{
  setNextSimTime(simTime_);
  setNextTimeScale(timeScale_);
  setNextPaused(paused_);
}

void WorldImpl::update(sen::kernel::RunApi& api)
{
  // Measured delta of SEN's clock: wall time when running, the stepped clock under TestKernel /
  // virtualTime (execution_model.md). std::optional rather than a TimeStamp{} sentinel: TimeStamp{}
  // is the epoch, which is where a TestKernel starts.
  const sen::TimeStamp now = api.getTime();
  const double dt = last_ ? (now - *last_).toSeconds() : 0.0;
  last_ = now;
  // The interval that just ended ran at the rate everyone was told last cycle. A setTimeScale or pause
  // received this cycle takes effect from now on, as it does in the drones once they read it; applied
  // to the past interval, every change would leave the clock up to one cycle x the change ahead of
  // the motion (8 s for 1x -> 100x).
  simTime_ += dt * rate_;
  rate_ = paused_ ? 0.0 : timeScale_;
  setNextSimTime(simTime_);
  setNextTimeScale(timeScale_);
  setNextPaused(paused_);
}

drone_sim::CommandAck WorldImpl::setTimeScaleImpl(double scale)
{
  if (!std::isfinite(scale) || scale < kMinTimeScale || scale > kMaxTimeScale)
    return {drone_sim::AckStatus::rejectedInvalid, "timeScale must be finite and within [0.05, 100]"};
  timeScale_ = scale;
  return {drone_sim::AckStatus::accepted, "ok"};
}

drone_sim::CommandAck WorldImpl::pauseImpl()
{
  paused_ = true;
  return {drone_sim::AckStatus::accepted, "ok"};
}

drone_sim::CommandAck WorldImpl::resumeImpl()
{
  paused_ = false;
  return {drone_sim::AckStatus::accepted, "ok"};
}

SEN_EXPORT_CLASS(WorldImpl)

}  // namespace world
