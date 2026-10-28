import { err, ok, type Result } from "@/lib/result";
import { applyPlanEvent } from "@/domain/plan/apply-event";
import type { PlanDetailsStore, StoredPick } from "@/domain/plan/details-store";
import type { EffectError, EffectRunner } from "@/domain/plan/effects";
import type { PlanRepository } from "@/domain/plan/repository";
import type { PlanEffect } from "@/domain/plan/types";
import type { TravellerService } from "@/domain/travellers/service";
import { BOOKING_FAILED_LINES, type BookingFailureKind } from "./announce";
import type {
  BookingTraveller,
  FlightSupplier,
  HoldReadiness,
  HotelSupplier,
  SupplierBookingKind,
  SupplierBookingStore,
  SupplierError,
  SupplierReceipt,
} from "./ports";

export interface BookingRunnerDeps {
  readonly plans: PlanRepository;
  readonly details: Pick<PlanDetailsStore, "load">;
  readonly travellers: Pick<TravellerService, "load">;
  readonly holds: HoldReadiness;
  readonly hotels: HotelSupplier;
  readonly flights: FlightSupplier;
  readonly bookings: SupplierBookingStore;
  /** Where the effects of the booking going well or badly go (charging the holds, or letting them go). */
  readonly onward: () => EffectRunner;
  readonly clock: () => Date;
  /**
   * Prices the plan's offers again just before booking, so the airline and hotel are asked for offers that are still
   * good. It can move the plan on (a price past someone's cap sends them back to approve), which stops the booking.
   */
  readonly renew?: (planId: string) => Promise<void>;
  /** Tells the group something in the chat. A failure to tell does not change the booking. */
  readonly announce?: (planId: string, line: string) => Promise<void>;
}

/** Why a booking was given up on. For logs and the chat's fixed lines, never shown with supplier detail. */
interface BookingFailure {
  readonly kind: BookingFailureKind;
  readonly message: string;
}

const fail = (kind: BookingFailureKind, message: string): Result<never, BookingFailure> => err({ kind, message });
/** Which fixed line fits a supplier's refusal. */
const kindOf = (error: SupplierError): BookingFailureKind => (error.code === "price_changed" ? "price" : error.code === "unavailable" ? "unavailable" : "other");
const describe = (what: string, error: SupplierError): string => `${what}: ${error.code}, ${error.message}`;

/**
 * Books the plan's hotels and flights with their suppliers, and only then lets the holds be charged. It is
 * all or nothing: if anything fails, every booking already made is cancelled and every hold is let go of, so
 * nobody is charged for a trip that did not happen. Hotels go first because they can be cancelled at once,
 * while an airline may take its time to confirm a cancellation.
 */
export class SupplierBookingRunner implements EffectRunner {
  constructor(private readonly deps: BookingRunnerDeps) {}

  async run(planId: string, _version: number, effects: readonly PlanEffect[]): Promise<Result<void, EffectError>> {
    const problems: string[] = [];
    for (const effect of effects) {
      if (effect.type !== "book") continue;
      const done = await this.bookPlan(planId);
      if (!done.ok) problems.push(done.error.message);
    }
    return problems.length === 0 ? ok(undefined) : err({ message: problems.join("; ") });
  }

  /** Cancels what was booked for a plan that is not going ahead. Safe to run again: it only touches what is still booked. */
  async cancelBookings(planId: string): Promise<Result<void, EffectError>> {
    const listed = await this.deps.bookings.list(planId);
    if (!listed.ok) return err({ message: `Bookings could not be listed: ${listed.error.message}` });

    const failures: string[] = [];
    for (const booking of listed.value) {
      if (booking.status === "cancelled") continue;
      const supplier = booking.kind === "hotel" ? this.deps.hotels : this.deps.flights;
      const cancelled = await supplier.cancel(booking.bookingId);
      if (!cancelled.ok) {
        failures.push(describe(`A ${booking.kind} booking could not be cancelled`, cancelled.error));
        continue;
      }
      const saved = await this.deps.bookings.setStatus(planId, booking.pickId, cancelled.value === "cancelled" ? "cancelled" : "cancelling");
      if (!saved.ok) failures.push(saved.error.message);
    }
    return failures.length === 0 ? ok(undefined) : err({ message: failures.join("; ") });
  }

  /**
   * Ends a plan that has been booking for too long, because the server stopped halfway or a supplier never answered.
   * The plan is ended first, which is also what makes it safe to cancel: only a plan still booking can be ended, so
   * a plan that has since been booked for real is never touched.
   */
  async settleStuck(planId: string): Promise<Result<void, EffectError>> {
    const failed = await applyPlanEvent(this.deps.plans, planId, { type: "booking_failed", at: this.deps.clock() });
    if (!failed.ok) return failed.error.kind === "transition" ? ok(undefined) : err({ message: "A stuck booking could not be ended" });

    await this.tell(planId, BOOKING_FAILED_LINES.stuck);
    const released = await this.deps.onward().run(planId, failed.value.version, failed.value.effects);
    const cancelled = await this.cancelBookings(planId);
    return cancelled.ok ? released : cancelled;
  }

  private async tell(planId: string, line: string): Promise<void> {
    try {
      await this.deps.announce?.(planId, line);
    } catch {
      // The chat line is a courtesy: the plan has already ended and the holds are being let go.
    }
  }

  private async bookPlan(planId: string): Promise<Result<void, EffectError>> {
    await this.deps.renew?.(planId);

    // Claim the plan first: from here it can no longer be replaced or expired by the deadline.
    const started = await applyPlanEvent(this.deps.plans, planId, { type: "booking_started", at: this.deps.clock() });
    if (!started.ok) {
      // Already claimed or finished (a second request to book): nothing to do.
      return started.error.kind === "transition" ? ok(undefined) : err({ message: "Booking could not start" });
    }

    const booked = await this.bookEverything(planId);
    if (!booked.ok) return this.giveUp(planId, booked.error);

    const succeeded = await applyPlanEvent(this.deps.plans, planId, { type: "booking_succeeded", at: this.deps.clock() });
    if (!succeeded.ok) {
      // The deadline passed while booking: nobody can be charged now, so the trip is undone.
      if (succeeded.error.kind === "transition") return this.giveUp(planId, { kind: "deadline", message: succeeded.error.error.message });
      // The plan could not be read or saved. It stays in booking for the sweeper to settle, not guessed at here.
      return err({ message: "The booking could not be recorded" });
    }
    return this.deps.onward().run(planId, succeeded.value.version, succeeded.value.effects);
  }

  /** Undoes the bookings, ends the plan and lets go of every hold. The plan ends even if a cancellation is still open. */
  private async giveUp(planId: string, reason: BookingFailure): Promise<Result<void, EffectError>> {
    const cancelled = await this.cancelBookings(planId);
    const failed = await applyPlanEvent(this.deps.plans, planId, { type: "booking_failed", at: this.deps.clock() });
    if (!failed.ok) {
      return failed.error.kind === "transition"
        ? cancelled
        : err({ message: `Booking failed (${reason.message}) and the plan could not be ended` });
    }
    await this.tell(planId, BOOKING_FAILED_LINES[reason.kind]);
    const released = await this.deps.onward().run(planId, failed.value.version, failed.value.effects);
    if (!cancelled.ok) return cancelled;
    return released;
  }

  private async bookEverything(planId: string): Promise<Result<void, BookingFailure>> {
    const loaded = await this.deps.plans.load(planId);
    if (!loaded.ok) return fail("other", "The plan could not be loaded");
    const memberIds = loaded.value.plan.members.map((member) => member.id);

    const details = await this.deps.details.load(planId);
    if (!details.ok) return fail("other", "The plan's picks could not be loaded");
    const picks = details.value.picks;

    const holds = await this.deps.holds.problem(planId, memberIds);
    if (!holds.ok) return fail("hold", `The card holds could not be checked: ${holds.error.message}`);
    if (holds.value !== null) return fail("hold", `A card hold is not ready: ${holds.value}`);

    const travellers = await this.loadTravellers(picks);
    if (!travellers.ok) return travellers;

    // Hotels first: a hotel can be cancelled at once, a flight may take time to cancel.
    for (const kind of ["hotel", "flight"] as const) {
      for (const pick of picks) {
        if (pick.offer.kind !== kind) continue;
        const booked = await this.bookPick(planId, pick, travellers.value);
        if (!booked.ok) return booked;
      }
    }
    return ok(undefined);
  }

  private async loadTravellers(picks: readonly StoredPick[]): Promise<Result<ReadonlyMap<string, BookingTraveller>, BookingFailure>> {
    const travellers = new Map<string, BookingTraveller>();
    for (const pick of picks) {
      if (pick.offer.kind === "activity") continue;
      for (const memberId of pick.memberIds) {
        if (travellers.has(memberId)) continue;
        const loaded = await this.deps.travellers.load(memberId);
        if (!loaded.ok) return fail("details", "A traveller's details could not be read");
        if (loaded.value === null) return fail("details", "A traveller has not given their details");
        travellers.set(memberId, { memberId, details: loaded.value });
      }
    }
    return ok(travellers);
  }

  private async bookPick(planId: string, pick: StoredPick, travellers: ReadonlyMap<string, BookingTraveller>): Promise<Result<void, BookingFailure>> {
    const { offer } = pick;
    if (offer.kind === "activity") return ok(undefined);

    const people = pick.memberIds.flatMap((memberId) => travellers.get(memberId) ?? []);
    const lead = people[0];
    if (!lead) return fail("details", "A booking has nobody to book it for");

    const reference = `${planId}:${pick.id}`;
    const maxTotalMinor = offer.totalMinor;
    const receipt: Result<SupplierReceipt, SupplierError> =
      offer.kind === "hotel"
        ? await this.deps.hotels.book({ offer, reference, lead, maxTotalMinor })
        : await this.deps.flights.book({ offer, reference, passengers: people, maxTotalMinor });
    if (!receipt.ok) return fail(kindOf(receipt.error), describe(`${offer.kind} booking failed`, receipt.error));

    const kind: SupplierBookingKind = offer.kind;
    const recorded = await this.deps.bookings.record({ planId, pickId: pick.id, kind, bookingId: receipt.value.bookingId, confirmation: receipt.value.confirmation, status: "booked" });
    if (!recorded.ok) {
      // A booking nobody knows about could never be cancelled, so undo it now.
      const supplier = kind === "hotel" ? this.deps.hotels : this.deps.flights;
      await supplier.cancel(receipt.value.bookingId);
      return fail("other", `A ${kind} booking could not be saved: ${recorded.error.message}`);
    }
    return ok(undefined);
  }
}
