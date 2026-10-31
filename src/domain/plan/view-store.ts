import type { Result } from "@/lib/result";
import type { BookingFailureKind, FailureCause, PartKind, UndonePart } from "@/domain/booking/failure";
import type { Offer } from "@/domain/offers/schema";
import type { VenueFacts } from "@/domain/schedule/venue";
import type { Cover, FxRateTable } from "@/domain/split/types";
import type { ApprovalStatus, PlanAgreementStatus, PlanStatus } from "./statuses";
import type { RepositoryError } from "./repository";

/** One person in a plan, with their name and where they stand. */
export interface ViewMember {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly planAgreement: PlanAgreementStatus;
  readonly approval: ApprovalStatus;
  readonly approvedMinor: number | null;
  /** What was really charged, once the trip is paid for. */
  readonly chargedMinor: number | null;
  readonly holdPlaced: boolean;
}

export interface ViewPick {
  readonly id: string;
  readonly offer: Offer;
  readonly memberIds: readonly string[];
  readonly reason: string;
  /** What the plan did for or about each person, by member id. */
  readonly notes: Readonly<Record<string, string>>;
}

export interface ViewIdea {
  readonly id: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly category: string;
  readonly why: string;
  readonly venue: VenueFacts;
}

/** A booking an airline or hotel made for one pick, with the supplier own confirmation code when it gave one. */
export interface ViewBooking {
  readonly pickId: string;
  readonly confirmation: string | null;
}

/** Why a plan's booking failed, as kept: which part, the reason, and what was cancelled again. */
export interface ViewFailure {
  readonly reason: BookingFailureKind;
  readonly cause: FailureCause | null;
  readonly part: { readonly kind: PartKind; readonly title: string } | null;
  readonly undone: readonly UndonePart[];
  readonly retryable: boolean;
}

/** Everything the plan screen shows, as stored. `buildPlanView` turns it into what is sent to the browser. */
export interface PlanViewRaw {
  readonly id: string;
  readonly groupId: string;
  readonly title: string;
  readonly summary: string | null;
  readonly status: PlanStatus;
  readonly deadlineAt: Date;
  readonly baseCurrency: string;
  readonly fx: FxRateTable;
  readonly headcount: number;
  /** Set once a newer plan has taken over from this one. */
  readonly replacedByPlanId: string | null;
  readonly trip: { readonly city: string | null; readonly departDate: string | null; readonly returnDate: string | null };
  readonly members: readonly ViewMember[];
  /** Friends paying some or all of someone else's part. */
  readonly covers: readonly Cover[];
  readonly picks: readonly ViewPick[];
  readonly ideas: readonly ViewIdea[];
  /** What the suppliers confirmed. Empty until the trip is booked, and when booking is only pretended. */
  readonly bookings: readonly ViewBooking[];
  /** Why booking failed, for a plan that ended that way. Absent (or null) for every other plan. */
  readonly failure?: ViewFailure | null;
}

export interface PlanViewStore {
  load(planId: string): Promise<Result<PlanViewRaw, RepositoryError>>;
  /** Which group a plan belongs to, for checking that the person asking is in it. Null if there is no such plan. */
  groupIdOf(planId: string): Promise<Result<string | null, RepositoryError>>;
}
