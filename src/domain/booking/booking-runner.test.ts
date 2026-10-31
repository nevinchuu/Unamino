import { describe, expect, it } from "vitest";
import { ok } from "@/lib/result";
import { DEADLINE, NOW } from "@/domain/plan/test-support";
import { SupplierBookingRunner } from "./booking-runner";
import { bookingFailedLine } from "./announce";
import { bookingSetup, MemoryFailureStore } from "./test-support";

const BOOK = [{ type: "book" }] as const;

function runnerFor(world: ReturnType<typeof bookingSetup>, clock: () => Date = () => NOW, renew?: (planId: string) => Promise<void>, announce?: (planId: string, line: string) => Promise<void>, failures?: MemoryFailureStore) {
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
    announce,
    failures,
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

  describe("telling the group which part failed", () => {
    const told = () => {
      const lines: string[] = [];
      return { lines, announce: async (_planId: string, line: string) => { lines.push(line); } };
    };
    const HOTEL_PART = { pickId: "pick-hotel", kind: "hotel", title: "Riverside Hotel", listingId: "hotel-room-1", offeredMinor: 40_000, currency: "USD" } as const;
    const FLIGHT_PART = { pickId: "pick-flight", kind: "flight", title: "SIN to BKK", listingId: "SIN-BKK-1", offeredMinor: 20_000, currency: "USD" } as const;

    it.each([
      ["a price rise", { code: "price_changed" }, "price", "its price went up"],
      ["a sold-out hotel", { code: "unavailable" }, "unavailable", "it is no longer available"],
      ["a refusal", { code: "rejected" }, "rejected", "the booking partner refused it"],
      ["a supplier that could not be reached", { code: "temporary" }, "temporary", "the booking partner could not be reached just now"],
    ] as const)("names the hotel and says why for %s, in a fixed line that holds nothing from the supplier", async (_name, failure, reason, phrase) => {
      const world = bookingSetup();
      world.hotels.failBooking = { ...failure, message: "SECRET passport K1234567A" };
      const { lines, announce } = told();
      const failures = new MemoryFailureStore();
      await runnerFor(world, () => NOW, undefined, announce, failures).run("plan-1", 5, BOOK);

      const next = reason === "temporary" ? "Mention @trippy to plan again, or to try the same plan once more." : "Mention @trippy to plan again.";
      expect(lines).toEqual([`The hotel Riverside Hotel could not be booked because ${phrase}. Nothing was charged and every card hold was let go. ${next}`]);
      expect(lines[0]).not.toContain("K1234567A");
      expect(failures.saved).toEqual([{ planId: "plan-1", reason, cause: null, part: HOTEL_PART, undone: [], retryable: reason === "temporary" }]);
    });

    it("tells the group why the partner refused, and keeps the cause, when the supplier's answer said", async () => {
      const world = bookingSetup();
      world.hotels.failBooking = { code: "rejected", cause: "meal_plan_changed", message: "SECRET board changed" };
      const { lines, announce } = told();
      const failures = new MemoryFailureStore();
      await runnerFor(world, () => NOW, undefined, announce, failures).run("plan-1", 5, BOOK);

      expect(lines[0]).toContain("The hotel Riverside Hotel could not be booked because the hotel changed the meal plan on that room");
      expect(lines[0]).not.toContain("SECRET");
      expect(failures.saved[0]).toMatchObject({ reason: "rejected", cause: "meal_plan_changed" });
    });

    it("names the flight, and the hotel that was booked and then cancelled, when the flight fails", async () => {
      const world = bookingSetup();
      world.flights.failBooking = { code: "unavailable", message: "sold out" };
      const { lines, announce } = told();
      const failures = new MemoryFailureStore();
      await runnerFor(world, () => NOW, undefined, announce, failures).run("plan-1", 5, BOOK);

      expect(lines).toEqual(["The flight SIN to BKK could not be booked because it is no longer available. The hotel Riverside Hotel had already been booked and was cancelled. Nothing was charged and every card hold was let go. Mention @trippy to plan again."]);
      expect(failures.saved).toEqual([{ planId: "plan-1", reason: "unavailable", cause: null, part: FLIGHT_PART, undone: [{ kind: "hotel", title: "Riverside Hotel" }], retryable: false }]);
    });

    it("names no single part when details are missing, a hold is gone or the time ran out", async () => {
      const missing = bookingSetup();
      missing.travellers.load = async () => ok(null);
      const a = told();
      const aFailures = new MemoryFailureStore();
      await runnerFor(missing, () => NOW, undefined, a.announce, aFailures).run("plan-1", 5, BOOK);

      const holdLost = bookingSetup();
      holdLost.holds.why = "gone";
      const b = told();
      const bFailures = new MemoryFailureStore();
      await runnerFor(holdLost, () => NOW, undefined, b.announce, bFailures).run("plan-1", 5, BOOK);

      const late = bookingSetup();
      const times = [NOW, new Date(DEADLINE.getTime() + 1)];
      let call = 0;
      const c = told();
      const cFailures = new MemoryFailureStore();
      await runnerFor(late, () => times[Math.min(call++, times.length - 1)], undefined, c.announce, cFailures).run("plan-1", 5, BOOK);

      expect([a.lines, b.lines]).toEqual([[bookingFailedLine({ reason: "details", part: null, undone: [] })], [bookingFailedLine({ reason: "hold", part: null, undone: [] })]]);
      expect(c.lines).toEqual([bookingFailedLine({ reason: "deadline", part: null, undone: [{ kind: "hotel", title: "Riverside Hotel" }, { kind: "flight", title: "SIN to BKK" }] })]);
      expect(c.lines[0]).toContain("The hotel Riverside Hotel and flight SIN to BKK had already been booked and were cancelled.");
      expect([aFailures.saved[0], bFailures.saved[0], cFailures.saved[0]].map((record) => [record.reason, record.part])).toEqual([["details", null], ["hold", null], ["deadline", null]]);
    });

    it("says nothing and saves nothing when the booking worked", async () => {
      const world = bookingSetup();
      const { lines, announce } = told();
      const failures = new MemoryFailureStore();
      await runnerFor(world, () => NOW, undefined, announce, failures).run("plan-1", 5, BOOK);
      expect(lines).toEqual([]);
      expect(failures.saved).toEqual([]);
    });

    it("still ends the plan and tells the group when the failure cannot be saved", async () => {
      const world = bookingSetup();
      world.hotels.failBooking = { code: "unavailable", message: "x" };
      const { lines, announce } = told();
      const failures = new MemoryFailureStore();
      failures.failing = true;
      await runnerFor(world, () => NOW, undefined, announce, failures).run("plan-1", 5, BOOK);
      expect(world.plans.plan.status).toBe("expired");
      expect(lines).toHaveLength(1);
    });

    it("still ends the plan when the chat cannot be reached", async () => {
      const world = bookingSetup();
      world.holds.why = "gone";
      await runnerFor(world, () => NOW, undefined, async () => { throw new Error("chat down"); }).run("plan-1", 5, BOOK);
      expect(world.plans.plan.status).toBe("expired");
    });
  });

  describe("settling a plan stuck in booking", () => {
    it("ends the plan, lets go of the holds, cancels what was booked and tells the group", async () => {
      const world = bookingSetup();
      world.plans.stored = { ...world.plans.stored, plan: { ...world.plans.plan, status: "booking" } };
      await world.bookings.record({ planId: "plan-1", pickId: "pick-hotel", kind: "hotel", bookingId: "H-1", confirmation: null, status: "booked" });
      const lines: string[] = [];
      const runner = runnerFor(world, () => NOW, undefined, async (_id, line) => { lines.push(line); });

      expect(await runner.settleStuck("plan-1")).toEqual(ok(undefined));
      expect(world.plans.plan.status).toBe("expired");
      expect(world.onward.types).toEqual(["release_holds"]);
      expect(world.hotels.cancelled).toEqual(["H-1"]);
      expect(lines).toEqual([bookingFailedLine({ reason: "stuck", part: null, undone: [{ kind: "hotel", title: "Riverside Hotel" }] })]);
    });

    it("leaves a plan that was booked for real alone, so its bookings are never cancelled", async () => {
      const world = bookingSetup();
      const runner = runnerFor(world);
      await world.bookings.record({ planId: "plan-1", pickId: "pick-hotel", kind: "hotel", bookingId: "H-1", confirmation: null, status: "booked" });
      world.plans.stored = { ...world.plans.stored, plan: { ...world.plans.plan, status: "booked" } };

      expect(await runner.settleStuck("plan-1")).toEqual(ok(undefined));
      expect(world.plans.plan.status).toBe("booked");
      expect(world.hotels.cancelled).toEqual([]);
    });
  });
});
