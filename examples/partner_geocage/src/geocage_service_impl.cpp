// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#include "geocage_service_impl.h"

namespace geocage_nodes
{

void GeocageServiceImpl::registered(sen::kernel::RegistrationApi& /*api*/)
{
  setNextGeocage(getInitialGeocage());  // staged: visible to everyone from the first commit
}

bool GeocageServiceImpl::setGeocageImpl(const geocage::Geocage& geocage)
{
  if (geocage.vertices.size() < 3 || geocage.minAltitude >= geocage.maxAltitude)
  {
    return false;
  }
  setNextGeocage(geocage);
  return true;
}

SEN_EXPORT_CLASS(GeocageServiceImpl)

}  // namespace geocage_nodes
