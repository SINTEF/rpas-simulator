// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#include "ground_station_impl.h"

namespace ground_station
{

void GroundStationImpl::registered(sen::kernel::RegistrationApi& /*api*/) { setNextHeartbeat(0); }

void GroundStationImpl::update(sen::kernel::RunApi& /*api*/) { setNextHeartbeat(getHeartbeat() + 1); }

SEN_EXPORT_CLASS(GroundStationImpl)

}  // namespace ground_station
