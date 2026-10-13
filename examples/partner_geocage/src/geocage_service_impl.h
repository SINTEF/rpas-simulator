// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#pragma once

#include "sen/kernel/component_api.h"
#include "stl/geocage/geocage.stl.h"

// The namespace MUST equal the package TARGET name in CMakeLists.txt (geocage_nodes): the YAML says
// `class: geocage_nodes.GeocageServiceImpl`.
namespace geocage_nodes
{

// swarm.bus/geocage: the geocage in force, set from the YAML at start and replaced by setGeocage().
class GeocageServiceImpl: public geocage::GeocageServiceBase
{
public:
  SEN_NOCOPY_NOMOVE(GeocageServiceImpl)

  using geocage::GeocageServiceBase::GeocageServiceBase;
  ~GeocageServiceImpl() override = default;

  void registered(sen::kernel::RegistrationApi& api) override;

protected:
  bool setGeocageImpl(const geocage::Geocage& geocage) override;
};

}  // namespace geocage_nodes
