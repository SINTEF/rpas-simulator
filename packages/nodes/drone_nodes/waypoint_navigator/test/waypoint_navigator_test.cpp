// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// WaypointNavigatorImpl flying the simulator's FlightControllerImpl under sen::kernel::TestKernel (virtual time,
// 1 s per step), all on one test bus. Pattern: packages/airframe/test/flight_controller_test.cpp.
#include "flight_controller_impl.h"
#include "geo.h"
#include "sen/core/obj/object_source.h"
#include "sen/kernel/component_api.h"
#include "sen/kernel/test_kernel.h"
#include "waypoint_navigator_impl.h"
#include "world_impl.h"

#include <gtest/gtest.h>

#include <chrono>
#include <functional>
#include <memory>
#include <string>

// Each waypoint is reached within envelope.arrivalRadius; after the last one the navigator reports arrived (and emits
// the arrived event exactly once) and the flight controller holds there.
TEST(WaypointNavigatorTest, fliesTheRouteByArrivalRadius)
{
  constexpr double kGround = 100.0;
  const drone_sim::GeoPosition origin {59.91, 10.75, kGround};
  auto world = std::make_shared<world::WorldImpl>("world", origin, drone_sim::Airspace {});
  auto fc = std::make_shared<airframe::FlightControllerImpl>("flight_controller",
                                                             std::string {"1"},
                                                             drone_sim::AirframeEnvelope {12.0, 18.0, 25.0, 100.0},
                                                             35.0,    // maxBankDegrees
                                                             10.0,    // maxFlightPathDegrees
                                                             80.0,    // loiterRadius: the hold circle, < arrivalRadius
                                                             std::string {"local.test"},
                                                             1.0,     // publishRate: every 1 s step
                                                             15.0,    // launchAcceleration
                                                             999.0,   // start position unset
                                                             999.0);
  auto navigator = std::make_shared<waypoint_navigator::WaypointNavigatorImpl>(
    "navigator", std::string {"1"}, std::string {"local.test"});

  sen::kernel::TestComponent component;
  std::shared_ptr<sen::ObjectSource> source;
  sen::ConnectionGuard arrivedGuard;  // keeps the event listener connected (a dropped guard disconnects)
  int arrivedCount = 0;
  uint32_t arrivedRouteId = 0;
  component.onInit(
    [&](sen::kernel::InitApi&& api) -> sen::kernel::PassResult
    {
      source = api.getSource("local.test");
      source->add(world);
      source->add(fc);
      source->add(navigator);
      // Receiving a SEN event: the callback runs on this component's queue, in a later drain.
      arrivedGuard = navigator->onArrived({api.getWorkQueue(),
                                           [&](uint32_t routeId)
                                           {
                                             ++arrivedCount;
                                             arrivedRouteId = routeId;
                                           }});
      return sen::kernel::done();
    });
  std::function<void(sen::MethodCallback<drone_sim::CommandAck>)> command;
  drone_sim::CommandAck ack {};
  component.onRun(
    [&](auto& api)
    {
      return api.execLoop(
        std::chrono::seconds(1),
        [&]()
        {
          if (command)
          {
            auto c = std::move(command);
            command = nullptr;
            c({api.getWorkQueue(), [&](const sen::MethodResult<drone_sim::CommandAck>& r) { ack = r.getValue(); }});
          }
        });
    });
  sen::kernel::TestKernel kernel(&component);
  auto issue = [&](std::function<void(sen::MethodCallback<drone_sim::CommandAck>)> c)
  {
    ack = {};
    command = std::move(c);
    kernel.step(4);
    return ack.status;
  };

  kernel.step(3);  // world discovered, airframe placed
  ASSERT_EQ(issue([&](auto cb) { fc->arm(std::move(cb)); }), drone_sim::AckStatus::accepted);
  ASSERT_EQ(issue([&](auto cb) { fc->takeoff(50.0, std::move(cb)); }), drone_sim::AckStatus::accepted);
  kernel.step(120);
  ASSERT_EQ(fc->getState().mode, drone_sim::FlightMode::hold);

  // Two waypoints 1 km north and 1 km north-east of the origin, 150 m AGL.
  drone_sim::Route route {7, {geo::nedToGeo(origin, 1000.0, 0.0, kGround + 150.0),
                              geo::nedToGeo(origin, 1000.0, 1000.0, kGround + 150.0)}};
  ASSERT_EQ(issue([&](auto cb) { navigator->setRoute(route, 0.0, std::move(cb)); }), drone_sim::AckStatus::accepted);
  for (int i = 0; i < 600 && navigator->getStatus() != drone_sim::NavigatorStatus::arrived; ++i)
  {
    kernel.step(1);
  }
  EXPECT_EQ(navigator->getStatus(), drone_sim::NavigatorStatus::arrived);
  kernel.step(30);  // holding at the last waypoint: the event must not fire again
  EXPECT_EQ(arrivedCount, 1);
  EXPECT_EQ(arrivedRouteId, 7U);
  EXPECT_EQ(navigator->getCurrentIndex(), 1U);
  EXPECT_EQ(fc->getState().mode, drone_sim::FlightMode::hold);
  // Arrived at the second waypoint, not on the way to it: within arrivalRadius (plus a 1 s step).
  EXPECT_LT(geo::horizontalDistance(fc->getState().position, route.waypoints[1]), 100.0 + 25.0);

  source.reset();
}
