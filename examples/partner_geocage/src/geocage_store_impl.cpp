// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#include "geocage_store_impl.h"

#include <iostream>

namespace geocage_nodes
{

void GeocageStoreImpl::registered(sen::kernel::RegistrationApi& api)
{
  setNextGeocage({});
  setNextReceived(false);
  setNextServiceUp(false);
  serviceSub_ = api.selectAllFrom<geocage::GeocageServiceInterface>(getSwarmBus());
}

void GeocageStoreImpl::update(sen::kernel::RunApi& /*api*/)
{
  // Containers start in any order, and the base station may go away: the list is empty meanwhile.
  const auto& services = serviceSub_->list.getObjects();
  const bool serviceUp = !services.empty();
  if (serviceUp != getServiceUp())
  {
    std::cout << getName() << ": service " << (serviceUp ? "up" : "gone, geocage kept") << std::endl;
    setNextServiceUp(serviceUp);
  }
  if (!serviceUp)
  {
    return;  // keep the last geocage heard
  }

  const geocage::Geocage& heard = services.front()->getGeocage();
  if (heard.vertices.size() >= 3 && !(getReceived() && heard == getGeocage()))
  {
    std::cout << getName() << ": geocage received, " << heard.vertices.size() << " vertices, " << heard.minAltitude
              << "–" << heard.maxAltitude << " m" << std::endl;
    setNextGeocage(heard);
    setNextReceived(true);
  }
}

SEN_EXPORT_CLASS(GeocageStoreImpl)

}  // namespace geocage_nodes
