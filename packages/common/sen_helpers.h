// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

#pragma once

// One-line reads of a sen::Subscription (no SEN objects of its own, header-only like geo.h).
// A subscription's `list` IS the current set of matching objects; it is read where the peer is
// used (`airbus/sen/examples/packages/calculators/src/client.cpp`). Shared via `DEPS drone_sim_common`.

#include "sen/core/obj/subscription.h"

#include <memory>

namespace sen_helpers
{

// The first (for a single-object peer: the only) object in the subscription, or nullptr (also for a
// subscription not opened yet: some are opened in the first update(), see the lock order in ARCHITECTURE.md section 8).
template <class T>
T* first(const std::shared_ptr<sen::Subscription<T>>& sub)
{
  if (sub == nullptr)
  {
    return nullptr;
  }
  const auto& objects = sub->list.getObjects();
  return objects.empty() ? nullptr : objects.front();
}

}  // namespace sen_helpers
