// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#pragma once

#include "sen/core/obj/subscription.h"
#include "sen/kernel/component_api.h"
#include "stl/geocage/geocage.stl.h"

#include <memory>

namespace geocage_nodes
{

// drone<ID>.bus/geocage_store: the last geocage heard from the base station's service on swarmBus
// (swarm.bus, the drone's air link), kept on the drone bus while the service is gone.
class GeocageStoreImpl: public geocage::GeocageStoreBase
{
public:
  SEN_NOCOPY_NOMOVE(GeocageStoreImpl)

  using geocage::GeocageStoreBase::GeocageStoreBase;
  ~GeocageStoreImpl() override = default;

  void registered(sen::kernel::RegistrationApi& api) override;
  void update(sen::kernel::RunApi& api) override;

private:
  // The service is a subscription, kept as a member: ONE typed query on swarm.bus and none on the drone
  // bus in this process (never a `SELECT *` beside it), see README.md.
  std::shared_ptr<sen::Subscription<geocage::GeocageServiceInterface>> serviceSub_;
};

}  // namespace geocage_nodes
