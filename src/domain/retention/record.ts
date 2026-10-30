import { planReference } from "@/lib/plan-reference";
import { RETENTION, recordKeptUntil } from "./policy";

/** One person's side of the money, as evidence that they agreed and were charged. No contact details, no card details. */
export interface RecordedPayment {
  readonly payerName: string;
  /** The payment provider's id for the hold that was charged, so the charge can be found there. */
  readonly paymentId: string | null;
  readonly approvedMinor: number | null;
  readonly chargedMinor: number | null;
  readonly currency: string;
}

export interface RecordedSupplier {
  readonly kind: string;
  readonly bookingId: string;
  readonly confirmation: string | null;
}

/** What is kept after a trip's group is deleted, to answer a card dispute. Deleted on `purgeAfter`. */
export interface BookingRecord {
  readonly planId: string;
  readonly reference: string;
  readonly planTitle: string;
  readonly city: string | null;
  readonly departDate: string | null;
  readonly returnDate: string | null;
  readonly payments: readonly RecordedPayment[];
  readonly suppliers: readonly RecordedSupplier[];
  /** "YYYY-MM-DD". */
  readonly purgeAfter: string;
}

export interface RecordSource {
  readonly planId: string;
  readonly title: string;
  readonly city: string | null;
  readonly departDate: string | null;
  readonly returnDate: string | null;
  /** The day the plan was made, "YYYY-MM-DD", for a trip with no dates. */
  readonly madeOn: string;
  readonly payments: readonly RecordedPayment[];
  readonly suppliers: readonly RecordedSupplier[];
}

const DAY_MS = 24 * 60 * 60_000;

/** The record to keep for a booked plan. A trip with no dates is kept for the same period counted from the day it was made. */
export function bookingRecordFor(source: RecordSource): BookingRecord {
  const fallback = new Date(Date.parse(`${source.madeOn}T00:00:00Z`) + RETENTION.recordDaysAfterTrip * DAY_MS).toISOString().slice(0, 10);
  return {
    planId: source.planId,
    reference: planReference(source.planId),
    planTitle: source.title,
    city: source.city,
    departDate: source.departDate,
    returnDate: source.returnDate,
    payments: source.payments,
    suppliers: source.suppliers,
    purgeAfter: recordKeptUntil(source) ?? fallback,
  };
}
