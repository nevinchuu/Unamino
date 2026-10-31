import type { Result } from "@/lib/result";
import type { FlightOffer, HotelOffer } from "@/domain/offers/schema";
import type { TravellerDetails } from "@/domain/travellers/details";
import type { BookingFailureRecord, FailureCause } from "./failure";

/** A person on a booking, with the details the airline or hotel needs. Only ever held in memory while booking. */
export interface BookingTraveller {
  readonly memberId: string;
  readonly details: TravellerDetails;
}

/**
 * "price_changed": the supplier now wants more than the offer said, so nothing was booked.
 * "unavailable": the offer is gone or can no longer be bought.
 * "rejected": the supplier refused what we sent (for example a missing passport).
 * "temporary": the supplier could not be reached or had an error. Nothing was booked.
 */
export type SupplierErrorCode = "price_changed" | "unavailable" | "rejected" | "temporary";

export interface SupplierError {
  readonly code: SupplierErrorCode;
  /** Why it was refused, when the answer says. It reaches the group in plain words, unlike `message`. */
  readonly cause?: FailureCause;
  /** For logs. It can name internals, so it is never shown to people. */
  readonly message: string;
}

/** What the supplier gave back for a booking it made. */
export interface SupplierReceipt {
  readonly bookingId: string;
  /** The supplier's own confirmation code, when it gives one. */
  readonly confirmation: string | null;
}

/** "pending": the supplier took the cancellation but has not finished it, so it is checked again later. */
export type CancelOutcome = "cancelled" | "pending";

export interface HotelBookingRequest {
  readonly offer: HotelOffer;
  /** Names this booking to the supplier. The same reference never books twice. */
  readonly reference: string;
  /** One lead guest per room. */
  readonly lead: BookingTraveller;
  /** The most the supplier may charge. A higher price means nothing is booked. */
  readonly maxTotalMinor: number;
}

export interface FlightBookingRequest {
  readonly offer: FlightOffer;
  readonly reference: string;
  /** Everyone on this flight. */
  readonly passengers: readonly BookingTraveller[];
  readonly maxTotalMinor: number;
}

export interface HotelSupplier {
  book(request: HotelBookingRequest): Promise<Result<SupplierReceipt, SupplierError>>;
  cancel(bookingId: string): Promise<Result<CancelOutcome, SupplierError>>;
}

export interface FlightSupplier {
  book(request: FlightBookingRequest): Promise<Result<SupplierReceipt, SupplierError>>;
  cancel(bookingId: string): Promise<Result<CancelOutcome, SupplierError>>;
}

export type SupplierBookingKind = "hotel" | "flight";
/** "cancelling": asked to cancel and waiting for the supplier to finish. */
export type SupplierBookingStatus = "booked" | "cancelling" | "cancelled";

/** One booking made with a supplier for one pick of a plan. Kept so it can be cancelled if the plan fails. */
export interface SupplierBooking {
  readonly planId: string;
  readonly pickId: string;
  readonly kind: SupplierBookingKind;
  readonly bookingId: string;
  readonly confirmation: string | null;
  readonly status: SupplierBookingStatus;
}

export interface BookingStoreError {
  readonly message: string;
}

export interface SupplierBookingStore {
  /** Saves a booking. Saving the same plan and pick again keeps the first one. */
  record(booking: SupplierBooking): Promise<Result<void, BookingStoreError>>;
  list(planId: string): Promise<Result<readonly SupplierBooking[], BookingStoreError>>;
  setStatus(planId: string, pickId: string, status: SupplierBookingStatus): Promise<Result<void, BookingStoreError>>;
  /** Plans that have been booking since before `before`, oldest first: the server probably stopped halfway. */
  stuckPlans(before: Date, limit: number): Promise<Result<readonly string[], BookingStoreError>>;
  /** Whether this plan has been booking since before `before`. */
  isStuck(planId: string, before: Date): Promise<Result<boolean, BookingStoreError>>;
  /** Plans that reached "everyone is in" before `before` and have not started booking: the request to book was probably lost. Oldest first. */
  stalledPlans(before: Date, limit: number): Promise<Result<readonly string[], BookingStoreError>>;
  /** Whether this plan has been waiting to start booking since before `before`. */
  isStalled(planId: string, before: Date): Promise<Result<boolean, BookingStoreError>>;
  /** Plans that ended while a supplier booking was still not cancelled, oldest first. */
  unsettledPlans(limit: number): Promise<Result<readonly string[], BookingStoreError>>;
}

/** Where the reason a booking failed is kept, so the group and Trippy can plan something different. A plan has at most one. */
export interface BookingFailureStore {
  save(record: BookingFailureRecord): Promise<Result<void, BookingStoreError>>;
}

/** Whether every card hold of a plan can still be charged. Checked just before anything is booked. */
export interface HoldReadiness {
  /** Ok(null) when all are ready, otherwise Ok(why not). An Err means it could not be checked. */
  problem(planId: string, memberIds: readonly string[]): Promise<Result<string | null, BookingStoreError>>;
}
