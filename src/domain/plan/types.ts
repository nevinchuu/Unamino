import type { ApprovalStatus, PlanStatus } from "./statuses";

/** All amounts are minor units of the member's own currency. */
export interface MemberSnapshot {
  readonly id: string;
  readonly approval: ApprovalStatus;
  /** The cap: the most this member agreed to pay, and the amount held on their card. */
  readonly approvedMinor: number | null;
  /** What the member owes at today's prices. At booking this is charged, and it never exceeds the cap. */
  readonly currentShareMinor: number | null;
  /** What was actually charged. Set once the holds are captured. */
  readonly chargedMinor: number | null;
  readonly approvalExpiresAt: Date | null;
  readonly holdPlaced: boolean;
}

export interface PlanSnapshot {
  readonly status: PlanStatus;
  /** Follows the offers: when they run out it is renewed or the plan ends. It can move later, up to the hard cap. */
  readonly deadlineAt: Date;
  /** The latest the deadline may ever be. The plan expires here whatever else happens. */
  readonly hardDeadlineAt: Date;
  readonly members: readonly MemberSnapshot[];
}

export type PlanEvent =
  | { readonly type: "approval_started"; readonly at: Date }
  | {
      readonly type: "member_approved";
      readonly at: Date;
      readonly memberId: string;
      readonly amountMinor: number;
      readonly expiresAt: Date;
    }
  | { readonly type: "member_declined"; readonly at: Date; readonly memberId: string }
  | { readonly type: "hold_placed"; readonly at: Date; readonly memberId: string }
  /** The offers were priced again: this is what the member owes now. */
  | {
      readonly type: "price_rechecked";
      readonly at: Date;
      readonly memberId: string;
      readonly currentMinor: number;
    }
  | { readonly type: "booking_succeeded"; readonly at: Date }
  | { readonly type: "booking_failed"; readonly at: Date }
  | { readonly type: "capture_succeeded"; readonly at: Date }
  | { readonly type: "deadline_passed"; readonly at: Date }
  /** The offers were renewed and still match, so the deadline moves later. */
  | { readonly type: "deadline_extended"; readonly at: Date; readonly newDeadlineAt: Date }
  /** A chosen listing can no longer be bought, so the plan cannot go ahead. */
  | { readonly type: "offers_unavailable"; readonly at: Date };

export type PlanEventType = PlanEvent["type"];

/** What to do with one member's hold at booking: charge `captureMinor`, give back `releaseMinor`. */
export interface HoldCapture {
  readonly memberId: string;
  readonly captureMinor: number;
  /** The unused part of the hold, returned to the same member and never moved to anyone else. */
  readonly releaseMinor: number;
}

/** Side effects the caller must run after a successful transition. */
export type PlanEffect =
  | { readonly type: "place_hold"; readonly memberId: string; readonly amountMinor: number }
  | { readonly type: "release_holds"; readonly memberIds: readonly string[] }
  | { readonly type: "request_reapproval"; readonly memberId: string; readonly newAmountMinor: number }
  | { readonly type: "book" }
  | { readonly type: "capture_holds"; readonly captures: readonly HoldCapture[] };

export type TransitionErrorCode =
  | "plan_closed"
  | "invalid_status"
  | "unknown_member"
  | "invalid_member_state"
  | "invalid_amount"
  | "invalid_expiry"
  | "no_members"
  | "deadline_not_reached"
  | "deadline_reached"
  | "invalid_deadline";

export interface TransitionError {
  readonly code: TransitionErrorCode;
  readonly message: string;
}

export type TransitionResult =
  | { readonly ok: true; readonly plan: PlanSnapshot; readonly effects: readonly PlanEffect[] }
  | { readonly ok: false; readonly error: TransitionError };
