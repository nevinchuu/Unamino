import { describe, expect, it } from "vitest";
import { NOW } from "@/domain/plan/test-support";
import { SupplierBookingRunner } from "./booking-runner";
import { BookingSweeper } from "./sweeper";
import { bookingSetup } from "./test-support";

function setup() {
  const world = bookingSetup();
  const runner = new SupplierBookingRunner({
    plans: world.plans, details: world.details, travellers: world.travellers, holds: world.holds, hotels: world.hotels, flights: world.flights, bookings: world.bookings, onward: () => world.onward, clock: () => NOW,
  });
  return { world, sweeper: new BookingSweeper(world.bookings, runner, () => NOW) };
}

describe("BookingSweeper", () => {
  it("ends a plan stuck in booking and cancels what was booked for it", async () => {
    const { world, sweeper } = setup();
    world.plans.stored = { ...world.plans.stored, plan: { ...world.plans.plan, status: "booking" } };
    await world.bookings.record({ planId: "plan-1", pickId: "pick-hotel", kind: "hotel", bookingId: "H-1", confirmation: null, status: "booked" });
    world.bookings.stuck = ["plan-1"];

    expect(await sweeper.sweep(10)).toEqual({ settled: 1, booked: 0, cancelled: 0, failed: 0 });
    expect(world.plans.plan.status).toBe("expired");
    expect(world.hotels.cancelled).toEqual(["H-1"]);
  });

  it("asks again for a cancellation that did not finish on a plan that has ended", async () => {
    const { world, sweeper } = setup();
    await world.bookings.record({ planId: "plan-1", pickId: "pick-flight", kind: "flight", bookingId: "F-1", confirmation: null, status: "cancelling" });
    world.bookings.ended = ["plan-1"];

    expect(await sweeper.sweep(10)).toEqual({ settled: 0, booked: 0, cancelled: 1, failed: 0 });
    expect(world.flights.cancelled).toEqual(["F-1"]);
    expect(world.bookings.rows[0].status).toBe("cancelled");
  });

  it("never cancels the bookings of a plan that has not ended", async () => {
    const { world, sweeper } = setup();
    await world.bookings.record({ planId: "plan-1", pickId: "pick-hotel", kind: "hotel", bookingId: "H-1", confirmation: null, status: "booked" });

    expect(await sweeper.sweep(10)).toEqual({ settled: 0, booked: 0, cancelled: 0, failed: 0 });
    expect(world.hotels.cancelled).toEqual([]);
  });

  it("counts a plan it could not finish, to try again next time", async () => {
    const { world, sweeper } = setup();
    await world.bookings.record({ planId: "plan-1", pickId: "pick-hotel", kind: "hotel", bookingId: "H-1", confirmation: null, status: "booked" });
    world.bookings.ended = ["plan-1"];
    world.hotels.failCancel = { code: "temporary", message: "timeout" };

    expect(await sweeper.sweep(10)).toEqual({ settled: 0, booked: 0, cancelled: 0, failed: 1 });
    expect(world.bookings.rows[0].status).toBe("booked");
  });

  it("settles one stuck plan when someone is looking at it", async () => {
    const { world, sweeper } = setup();
    world.plans.stored = { ...world.plans.stored, plan: { ...world.plans.plan, status: "booking" } };
    world.bookings.stuck = ["plan-1"];
    await sweeper.settlePlan("plan-1");
    expect(world.plans.plan.status).toBe("expired");
  });

  it("books a plan that reached everyone-has-approved but whose request to book was lost", async () => {
    const { world, sweeper } = setup();
    expect(world.plans.plan.status).toBe("held");
    world.bookings.stalled = ["plan-1"];

    expect(await sweeper.sweep(10)).toEqual({ settled: 0, booked: 1, cancelled: 0, failed: 0 });
    expect(world.plans.plan.status).toBe("booked");
    expect(world.log).toEqual(["book H", "book F"]);
    expect(world.onward.types).toEqual(["capture_holds"]);
  });

  it("does not book a plan that has not been waiting long", async () => {
    const { world, sweeper } = setup();

    expect(await sweeper.sweep(10)).toEqual({ settled: 0, booked: 0, cancelled: 0, failed: 0 });
    expect(world.plans.plan.status).toBe("held");
    expect(world.log).toEqual([]);
  });

  it("books a waiting plan once even if the sweep runs twice", async () => {
    const { world, sweeper } = setup();
    world.bookings.stalled = ["plan-1"];

    await sweeper.sweep(10);
    await sweeper.sweep(10);
    expect(world.hotels.booked).toHaveLength(1);
    expect(world.flights.booked).toHaveLength(1);
  });

  it("undoes everything and ends the plan when the lost booking is tried and a part fails", async () => {
    const { world, sweeper } = setup();
    world.bookings.stalled = ["plan-1"];
    world.flights.failBooking = { code: "rejected", message: "sold out" };

    await sweeper.sweep(10);
    expect(world.plans.plan.status).toBe("expired");
    expect(world.hotels.cancelled).toEqual(["H-1"]);
  });

  it("books one waiting plan when someone is looking at it", async () => {
    const { world, sweeper } = setup();
    world.bookings.stalled = ["plan-1"];
    await sweeper.settlePlan("plan-1");
    expect(world.plans.plan.status).toBe("booked");
  });

  it("leaves a plan that is only booking right now", async () => {
    const { world, sweeper } = setup();
    world.plans.stored = { ...world.plans.stored, plan: { ...world.plans.plan, status: "booking" } };
    await sweeper.settlePlan("plan-1");
    expect(world.plans.plan.status).toBe("booking");
  });
});
