// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#include "imaging_sensor_impl.h"

#include "geo.h"
#include "sen_helpers.h"

#include <cmath>

namespace imaging_sensor
{

using sen_helpers::first;

void ImagingSensorImpl::registered(sen::kernel::RegistrationApi& api)
{
  setNextTracks({});

  flightControllerSub_ = api.selectAllFrom<drone_sim::FlightControllerInterface>(getDroneBus());
  assetSub_ = api.selectAllFrom<drone_sim::GroundAssetInterface>(getSimBus());
}

void ImagingSensorImpl::update(sen::kernel::RunApi& /*api*/)
{
  drone_sim::FlightControllerInterface* flightController = first(flightControllerSub_);
  if (flightController == nullptr)
  {
    return;
  }
  const drone_sim::VehicleState& own = flightController->getState();
  const double halfFieldOfViewRadians = 0.5 * getFieldOfViewDegrees() * geo::kDegreesToRadians;

  drone_sim::TrackList tracks;
  for (auto* asset: assetSub_->list.getObjects())
  {
    const drone_sim::GeoPosition& position = asset->getPosition();
    const double horizontal = geo::horizontalDistance(own.position, position);
    const double down = own.position.altitude.get() - position.altitude.get();  // sensor looks down
    if (down <= 0.0)
    {
      continue;  // on or below the asset: nothing in the cone
    }
    const bool inRange = std::hypot(horizontal, down) <= getRange();
    const bool inCone = std::atan2(horizontal, down) <= halfFieldOfViewRadians;
    if (inRange && inCone)
    {
      tracks.push_back(drone_sim::Track {
        asset->asObject().getName(),
        std::string(sen::StringConversionTraits<drone_sim::AssetType>::toString(asset->getAssetType())),
        position,
        own.stateTime});
    }
  }
  setNextTracks(tracks);
}

SEN_EXPORT_CLASS(ImagingSensorImpl)

}  // namespace imaging_sensor
