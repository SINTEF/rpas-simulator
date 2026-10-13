// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// FlightControllerImpl stepped under sen::kernel::TestKernel (virtual time, 1 s per step), next to a
// WorldImpl on the same test bus (simBus = that bus). Pattern: packages/world/test/world_test.cpp.
#include "flight_controller_impl.h"
#include "geo.h"
#include "sen/core/obj/object_source.h"
#include "sen/kernel/component_api.h"
#include "sen/kernel/test_kernel.h"
#include "world_impl.h"

#include <gtest/gtest.h>

#include <chrono>
#include <functional>
#include <memory>
#include <string>
#include <unistd.h>

namespace
{
constexpr double kGround = 100.0;

using Command = std::function<void(sen::MethodCallback<drone_sim::CommandAck>)>;

// A world and a flight controller on local.test, a component that runs `job` / issues `command` in
// its next cycle, and a kernel to step it.
class FlightControllerTest: public ::testing::Test
{
protected:
  FlightControllerTest()
  {
    component_.onInit(
      [this](sen::kernel::InitApi&& api) -> sen::kernel::PassResult
      {
        source = api.getSource("local.test");
        source->add(world);
        source->add(fc);
        return sen::kernel::done();
      });
    component_.onRun(
      [this](auto& api)
      {
        return api.execLoop(std::chrono::seconds(1),
                            [this, &api]()
                            {
                              if (job)
                              {
                                auto j = std::move(job);
                                job = nullptr;
                                j();
                              }
                              if (command)
                              {
                                auto c = std::move(command);
                                command = nullptr;
                                c({api.getWorkQueue(),
                                   [this](const sen::MethodResult<drone_sim::CommandAck>& r) { ack = r.getValue(); }});
                              }
                            });
      });
    kernel = std::make_unique<sen::kernel::TestKernel>(&component_);
  }

  ~FlightControllerTest() override { source.reset(); }

  // A command is issued on the next cycle; its ack arrives 1-2 cycles later.
  drone_sim::CommandAck issue(Command c)
  {
    ack = {};
    command = std::move(c);
    kernel->step(4);
    return ack;
  }

  // Armed, took off to 50 m AGL, holding.
  void takeOff()
  {
    kernel->step(3);  // world discovered, airframe placed
    ASSERT_EQ(issue([&](auto cb) { fc->arm(std::move(cb)); }).status, drone_sim::AckStatus::accepted) << ack.message;
    ASSERT_EQ(issue([&](auto cb) { fc->takeoff(50.0, std::move(cb)); }).status, drone_sim::AckStatus::accepted)
      << ack.message;
    kernel->step(120);
    ASSERT_EQ(fc->getState().mode, drone_sim::FlightMode::hold);
    ASSERT_GT(fc->getState().position.altitude.get(), kGround + 40.0);
  }

  std::shared_ptr<world::WorldImpl> world = std::make_shared<world::WorldImpl>(
    "world", drone_sim::GeoPosition {59.91, 10.75, kGround}, drone_sim::Airspace {});
  std::shared_ptr<airframe::FlightControllerImpl> fc =
    std::make_shared<airframe::FlightControllerImpl>("flight_controller",
                                                     std::string {"1"},
                                                     drone_sim::AirframeEnvelope {12.0, 18.0, 25.0, 100.0},
                                                     35.0,    // maxBankDegrees
                                                     10.0,    // maxFlightPathDegrees
                                                     80.0,    // loiterRadius
                                                     std::string {"local.test"},
                                                     1.0,     // publishRate: every 1 s step
                                                     15.0,    // launchAcceleration
                                                     999.0,   // start position unset
                                                     999.0);
  std::shared_ptr<sen::ObjectSource> source;
  std::function<void()> job;
  Command command;
  drone_sim::CommandAck ack {};
  std::unique_ptr<sen::kernel::TestKernel> kernel;

private:
  sen::kernel::TestComponent component_;
};
}  // namespace

// Battery 0 in the air -> crashed, glides down, lies still, refuses commands.
TEST_F(FlightControllerTest, emptyBatteryInTheAirCrashes)
{
  takeOff();

  // Drain the rest of the 1800 s battery: the motors stop in the air.
  bool sawGlide = false;
  for (int i = 0; i < 1800 && fc->getState().mode != drone_sim::FlightMode::crashed; ++i)
  {
    kernel->step(1);
  }
  ASSERT_EQ(fc->getState().mode, drone_sim::FlightMode::crashed);
  EXPECT_DOUBLE_EQ(fc->getState().battery, 0.0);
  for (int i = 0; i < 120; ++i)
  {
    kernel->step(1);
    sawGlide = sawGlide || fc->getState().verticalSpeed < -1.0;
  }
  EXPECT_TRUE(sawGlide);
  EXPECT_EQ(fc->getState().mode, drone_sim::FlightMode::crashed);
  EXPECT_NEAR(fc->getState().position.altitude.get(), kGround, 0.01);
  EXPECT_LT(fc->getState().groundSpeed, 0.01);

  const double stateTime = fc->getState().stateTime;
  EXPECT_EQ(issue([&](auto cb) { fc->arm(std::move(cb)); }).status, drone_sim::AckStatus::rejectedState);
  EXPECT_EQ(ack.message, "crashed");
  EXPECT_GT(fc->getState().stateTime, stateTime);  // still reporting
}

// The time the world is away (Reset) is not flown in one step when it returns.
TEST_F(FlightControllerTest, noCatchUpStepWhenTheWorldReturns)
{
  takeOff();
  ASSERT_EQ(issue([&](auto cb) { fc->setVelocity({18.0, 0.0, 0.0}, std::move(cb)); }).status,
            drone_sim::AckStatus::accepted);  // straight north, level
  kernel->step(2);

  job = [this]() { source->remove(world); };
  kernel->step(2);
  const drone_sim::GeoPosition before = fc->getState().position;
  kernel->step(30);  // 30 s without a world: the airframe stands still
  EXPECT_LT(geo::horizontalDistance(fc->getState().position, before), 1.0);

  job = [this]() { source->add(world); };
  kernel->step(3);  // rediscovered, a few 1 s steps flown
  EXPECT_LT(geo::horizontalDistance(fc->getState().position, before), 4 * 25.0);  // not 30 s x 18 m/s
  EXPECT_GT(geo::horizontalDistance(fc->getState().position, before), 1.0);       // flying again
}

// A world whose clock never advances (swapped in for the real one) is flown through, and the stamp
// moves with the flight.
namespace
{
class StalledWorld: public world::WorldImpl
{
public:
  using world::WorldImpl::WorldImpl;
  void update(sen::kernel::RunApi& /*api*/) override {}
};
}  // namespace

TEST_F(FlightControllerTest, stampMovesWithTheFlightWhileTheWorldStalls)
{
  takeOff();
  auto stalled = std::make_shared<StalledWorld>(
    "stalled_world", drone_sim::GeoPosition {59.91, 10.75, kGround}, drone_sim::Airspace {});
  job = [this, stalled]()
  {
    source->remove(world);
    source->add(stalled);
  };
  kernel->step(3);
  const double stamp = fc->getState().stateTime;
  const drone_sim::GeoPosition before = fc->getState().position;
  kernel->step(10);
  EXPECT_DOUBLE_EQ(stalled->getSimTime(), 0.0);
  EXPECT_DOUBLE_EQ(fc->getState().stateTime - stamp, 10.0);  // one 1 s step per cycle
  EXPECT_GT(geo::horizontalDistance(fc->getState().position, before), 100.0);  // flying
}

// Flown into the ground (setVelocity with a sink rate) -> crashed, like an empty battery.
TEST_F(FlightControllerTest, groundContactInFlightCrashes)
{
  takeOff();
  ASSERT_EQ(issue([&](auto cb) { fc->setVelocity({18.0, 0.0, 5.0}, std::move(cb)); }).status,
            drone_sim::AckStatus::accepted);  // NED: +5 m/s down
  for (int i = 0; i < 120 && fc->getState().mode != drone_sim::FlightMode::crashed; ++i)
  {
    kernel->step(1);
  }
  ASSERT_EQ(fc->getState().mode, drone_sim::FlightMode::crashed);
  kernel->step(2);
  EXPECT_NEAR(fc->getState().position.altitude.get(), kGround, 0.01);
  EXPECT_LT(fc->getState().groundSpeed, 0.01);
  EXPECT_GT(fc->getState().battery, 0.0);  // not the battery
  EXPECT_EQ(issue([&](auto cb) { fc->setVelocity({18.0, 0.0, 0.0}, std::move(cb)); }).status,
            drone_sim::AckStatus::rejectedState);
}

// An unflyable envelope is refused at startup, never clamped. SEN logs the exception and
// stops the kernel (under TestKernel the process dies), hence death tests.
namespace
{
void startWith(const drone_sim::AirframeEnvelope& envelope, double loiterRadius)
{
  dup2(2, 1);  // SEN's logger writes to stdout; the death test matches stderr
  auto fc = std::make_shared<airframe::FlightControllerImpl>("flight_controller",
                                                             std::string {"1"},
                                                             envelope,
                                                             35.0,
                                                             10.0,
                                                             loiterRadius,
                                                             std::string {"local.test"},
                                                             1.0,
                                                             15.0,
                                                             999.0,
                                                             999.0);
  sen::kernel::TestComponent component;
  std::shared_ptr<sen::ObjectSource> source;
  component.onInit(
    [&](sen::kernel::InitApi&& api) -> sen::kernel::PassResult
    {
      source = api.getSource("local.test");
      source->add(fc);
      return sen::kernel::done();
    });
  sen::kernel::TestKernel kernel(&component);
  kernel.step(1);
}
}  // namespace

TEST(FlightControllerStatics, arrivalRadiusInsideTheHoldCircleIsRefused)
{
  ::testing::FLAGS_gtest_death_test_style = "threadsafe";
  EXPECT_DEATH(startWith({12.0, 18.0, 25.0, 80.0}, 80.0),  // loiterRadius == arrivalRadius
               "arrivalRadius 80.0+ m must be greater than loiterRadius 80.0+ m");
}

TEST(FlightControllerStatics, unflyableEnvelopeIsRefused)
{
  ::testing::FLAGS_gtest_death_test_style = "threadsafe";
  EXPECT_DEATH(startWith({12.0, 18.0, 25.0, 100.0}, 30.0),  // tightest turn at 18 m/s and 35 deg: ~47 m
               "loiterRadius 30.0+ m must be at least 47.[0-9]+ m");
  EXPECT_DEATH(startWith({12.0, 30.0, 25.0, 100.0}, 80.0), "cruiseSpeed 30.0+ m/s must lie in");
}
