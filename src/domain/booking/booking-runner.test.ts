import { describe, expect, it } from "vitest";
import { ok } from "@/lib/result";
import { DEADLINE, NOW } from "@/domain/plan/test-support";
import { SupplierBookingRunner } from "./booking-runner";
import { bookingSetup } from "./test-support";

const BOOK = [{ type: "book" }] as const;

function runnerFor(world: ReturnType<typeof bookingSetup>, clock: () => Date = () => NOW, renew?: (planId: string) => Promise<void>) {
  return new SupplierBookingRunner({
    plans: world.plans,
    details: world.details,
    travellers: world.travellers,
    holds: world.holds,
    hotels: world.hotels,
    flights: world.flights,
    bookings: world.bookings,
    onward: () => world.onward,
    clock,
    renew,
  });
}

describe("SupplierBookingRunner", () => {
  it("books the hotel, then the flight, and only then asks for the holds to be charged", async () => {
    const world = bookingSetup();
    expect(await runnerFor(world).run("plan-1", 5, BOOK)).toEqual(ok(undefined));

    expect(world.log).toEqual(["book H", "book F"]);
    expect(world.plans.plan.status).toBe("booked");
    expect(world.onward.types).toEqual(["capture_holds"]);
    expect(world.bookings.rows.map((row) => [row.pickId, row.kind, row.bookingId, row.status])).toEqual([
      ["pick-hotel", "hotel", "H-1", "booked"],
      ["pick-flight", "flight", "F-1", "booked"],
    ]);
  });

  it("books each flight for everyone on it and each room with one lead guest, naming the booking after the plan", async () => {
    const world = bookingSetup();
    await runnerFor(world).run("plan-1", 5, BOOK);

    const [room] = world.hotels.booked;
    const [flightRequest] = world.flights.booked;
    expect(room).toMatchObject({ reference: "plan-1:pick-hotel", maxTotalMinor: 40_000, lead: { memberId: "ana" } });
    expect(flightRequest).toMatchObject({ reference: "plan-1:pick-flight", maxTotalMinor: 20_000 });
    expect("passengers" in flightRequest && flightRequest.passengers.map((p) => p.memberId)).toEqual(["ana", "ben"]);
  });

  it("cancels the hotel, ends the plan and lets go of the holds when the flight cannot be booked", async () => {
    const world = bookingSetup();
    world.flights.failBooking = { code: "unavailable", message: "sold out" };
    await runnerFor(world).run("plan-1", 5, BOOK);

    expect(world.log).toEqual(["book H", "book F", "cancel H-1"]);
    expect(world.bookings.rows[0].status).toBe("cancelled");
    expect(world.plans.plan.status).toBe("expired");
    expect(world.onward.types).toEqual(["release_holds"]);
  });

  it("books nothing when the supplier wants more than the offer said", async () => {
    const world = bookingSetup();
    world.hotels.failBooking = { code: "price_changed", message: "now 450" };
    await runnerFor(world).run("plan-1", 5, BOOK);

    expect(world.bookings.rows).toEqual([]);
    expect(world.plans.plan.status).toBe("expired");
    expect(world.onward.types).toEqual(["release_holds"]);
  });

  it("books nothing and ends the plan when someone has not given their details", async () => {
    const world = bookingSetup();
    world.travellers.load = async () => ok(null);
    await runnerFor(world).run("plan-1", 5, BOOK);

    expect(world.log).toEqual([]);
    expect(world.plans.plan.status).toBe("expired");
  });

  it("books nothing when a card hold is no longer ready", async () => {
    const world = bookingSetup();
    world.holds.why = "the hold was cancelled";
    await runnerFor(world).run("plan-1", 5, BOOK);

    expect(world.log).toEqual([]);
    expect(world.plans.plan.status).toBe("expired");
    expect(world.onward.types).toEqual(["release_holds"]);
  });

  it("books nothing when the holds cannot be checked", async () => {
    const world = bookingSetup();
    world.holds.unreachable = true;
    await runnerFor(world).run("plan-1", 5, BOOK);

    expect(world.log).toEqual([]);
    expect(world.plans.plan.status).toBe("expired");
  });

  it("undoes everything when the deadline passes while booking, so nobody is charged", async () => {
    const world = bookingSetup();
    const times = [NOW, new Date(DEADLINE.getTime() + 1)];
    let call = 0;
    await runnerFor(world, () => times[Math.min(call++, times.length - 1)]).run("plan-1", 5, BOOK);

    expect(world.log).toEqual(["book H", "book F", "cancel H-1", "cancel F-1"]);
    expect(world.plans.plan.status).toBe("expired");
    expect(world.onward.types).toEqual(["release_holds"]);
  });

  it("keeps a pending airline cancellation to check again, and still ends the plan", async () => {
    const world = bookingSetup();
    world.hotels.failBooking = null;
    world.flights.cancelOutcome = "pending";
    world.holds.why = null;
    // The flight books, then the deadline passes, so the flight cancellation comes back pending.
    const times = [NOW, new Date(DEADLINE.getTime() + 1)];
    let call = 0;
    expect(await runnerFor(world, () => times[Math.min(call++, times.length - 1)]).run("plan-1", 5, BOOK)).toEqual(ok(undefined));

    expect(world.bookings.rows.find((row) => row.kind === "flight")?.status).toBe("cancelling");
    expect(world.plans.plan.status).toBe("expired");
  });

  it("still ends the plan and reports it when a cancellation fails", async () => {
    const world = bookingSetup();
    world.flights.failBooking = { code: "temporary", message: "timeout" };
    world.hotels.failCancel = { code: "temporary", message: "timeout" };
    const result = await runnerFor(world).run("plan-1", 5, BOOK);

    expect(result.ok).toBe(false);
    expect(world.bookings.rows[0].status).toBe("booked");
    expect(world.plans.plan.status).toBe("expired");
    expect(world.onward.types).toEqual(["release_holds"]);
  });

  it("cancels a booking it could not save, because nobody could cancel it later", async () => {
    const world = bookingSetup();
    world.bookings.failRecord = true;
    await runnerFor(world).run("plan-1", 5, BOOK);

    expect(world.hotels.cancelled).toEqual(["H-1"]);
    expect(world.plans.plan.status).toBe("expired");
  });

  it("does nothing the second time it is asked to book the same plan", async () => {
    const world = bookingSetup();
    const runner = runnerFor(world);
    await runner.run("plan-1", 5, BOOK);
    expect(await runner.run("plan-1", 6, BOOK)).toEqual(ok(undefined));

    expect(world.hotels.booked).toHaveLength(1);
    expect(world.flights.booked).toHaveLength(1);
  });

  it("prices the offers again before it books anything", async () => {
    const world = bookingSetup();
    await runnerFor(world, () => NOW, async () => { world.log.push("renew"); }).run("plan-1", 5, BOOK);

    expect(world.log).toEqual(["renew", "book H", "book F"]);
  });

  it("does not book when renewing the prices sent someone back to approve", async () => {
    const world = bookingSetup();
    const renew = async () => { world.plans.stored = { ...world.plans.stored, version: world.plans.stored.version + 1, plan: { ...world.plans.plan, status: "approving" } }; };
    await runnerFor(world, () => NOW, renew).run("plan-1", 5, BOOK);

    expect(world.log).toEqual([]);
    expect(world.plans.plan.status).toBe("approving");
  });

  it("leaves every other kind of effect alone", async () => {
    const world = bookingSetup();
    await runnerFor(world).run("plan-1", 5, [{ type: "release_holds", memberIds: ["ana"] }]);

    expect(world.log).toEqual([]);
    expect(world.plans.plan.status).toBe("held");
  });

  it("skips a plan whose deadline has passed before booking starts", async () => {
    const world = bookingSetup();
    await runnerFor(world, () => new Date(DEADLINE.getTime() + 1)).run("plan-1", 5, BOOK);

    expect(world.log).toEqual([]);
    expect(world.plans.plan.status).toBe("held");
  });

  it("cancels only what is still booked when cancelling again", async () => {
    const world = bookingSetup();
    world.flights.failBooking = { code: "unavailable", message: "sold out" };
    const runner = runnerFor(world);
    await runner.run("plan-1", 5, BOOK);
    expect(await runner.cancelBookings("plan-1")).toEqual(ok(undefined));

    expect(world.hotels.cancelled).toEqual(["H-1"]);
  });
});
