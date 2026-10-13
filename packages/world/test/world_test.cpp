// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// WorldImpl stepped under sen::kernel::TestKernel (virtual time, 1 s per step): the pattern for
// any SEN object test in this repo. Shape after airbus/sen/libs/kernel/test/unit/test_kernel/.
#include "ground_asset_impl.h"
#include "sen/core/obj/object_source.h"
#include "sen/kernel/component_api.h"
#include "sen/kernel/test_kernel.h"
#include "world_impl.h"

#include <gtest/gtest.h>

#include <chrono>
#include <memory>
#include <string>

TEST(WorldTest, simTimeAdvancesAndTimeScaleIsHonoured)
{
  // Programmatic ctor: the statics config/world.yaml would supply (an empty airspace here).
  auto world =
    std::make_shared<world::WorldImpl>("world", drone_sim::GeoPosition {59.91, 10.75, 0.0}, drone_sim::Airspace {});

  sen::kernel::TestComponent component;
  std::shared_ptr<sen::ObjectSource> source;
  component.onInit(
    [&](sen::kernel::InitApi&& api) -> sen::kernel::PassResult
    {
      source = api.getSource("local.test");
      source->add(world);
      return sen::kernel::done();
    });
  // The run loop is entered once; a flag lets a later step issue the method call. No `this` in a
  // test, so the work queue owns the result callback (arrives 1-2 cycles after the call).
  bool requestScale = false;
  drone_sim::CommandAck ack {};
  component.onRun(
    [&](auto& api)
    {
      return api.execLoop(
        std::chrono::seconds(1),
        [&]()
        {
          if (requestScale)
          {
            requestScale = false;
            world->setTimeScale(
              2.0,
              {api.getWorkQueue(), [&](const sen::MethodResult<drone_sim::CommandAck>& r) { ack = r.getValue(); }});
          }
        });
    });

  sen::kernel::TestKernel kernel(&component);

  // Cycle 0 has no previous tick (dt 0); cycle 1 integrates 1 s; each commit publishes simTime.
  kernel.step(2);
  EXPECT_DOUBLE_EQ(world->getSimTime(), 1.0);
  EXPECT_DOUBLE_EQ(world->getTimeScale(), 1.0);

  // setTimeScale(2.0): received a cycle or two later, staged in that update, visible after its commit.
  // The cycle that receives it still adds 1 s (the interval before the change), the next one 2 s.
  requestScale = true;
  double before = world->getSimTime();
  for (int i = 0; i < 5 && world->getTimeScale() != 2.0; ++i)
  {
    before = world->getSimTime();
    kernel.step(1);
  }
  kernel.step(2);  // the ack arrives
  EXPECT_EQ(ack.status, drone_sim::AckStatus::accepted);
  ASSERT_DOUBLE_EQ(world->getTimeScale(), 2.0);
  EXPECT_DOUBLE_EQ(world->getSimTime() - before, 1.0 + 2.0 + 2.0);

  source.reset();
}

// A ground asset steps in the world's cycle but reads the world's previous commit; its stamp still
// names the time of the position it publishes, the simTime the world commits in the same cycle.
TEST(WorldTest, groundAssetStampIsTheWorldTimeOfItsPosition)
{
  auto world =
    std::make_shared<world::WorldImpl>("world", drone_sim::GeoPosition {59.91, 10.75, 0.0}, drone_sim::Airspace {});
  auto tank = std::make_shared<world::GroundAssetImpl>(
    "tank1",
    std::string {"local.test"},
    drone_sim::AssetType::tank,
    6.0,
    drone_sim::GeoPositionList {{59.91, 10.75, 0.0}, {59.92, 10.75, 0.0}});

  sen::kernel::TestComponent component;
  std::shared_ptr<sen::ObjectSource> source;
  component.onInit(
    [&](sen::kernel::InitApi&& api) -> sen::kernel::PassResult
    {
      source = api.getSource("local.test");
      source->add(world);
      source->add(tank);
      return sen::kernel::done();
    });
  component.onRun([](auto& api) { return api.execLoop(std::chrono::seconds(1), []() {}); });
  sen::kernel::TestKernel kernel(&component);

  kernel.step(5);
  EXPECT_GT(tank->getStateTime(), 0.0);
  EXPECT_DOUBLE_EQ(tank->getStateTime(), world->getSimTime());

  source.reset();
}
