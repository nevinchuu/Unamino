import { describe, expect, it } from "vitest";
import { bookingRecordFor, type RecordSource } from "./record";

const source = (overrides: Partial<RecordSource> = {}): RecordSource => ({
  planId: "7f3a2c11-0000-4000-8000-000000000000",
  title: "Bangkok 3-night hotel stay",
  city: "Bangkok",
  departDate: "2026-12-15",
  returnDate: "2026-12-18",
  madeOn: "2026-10-30",
  payments: [{ payerName: "Maya", paymentId: "pi_1", approvedMinor: 6_369, chargedMinor: 6_369, currency: "USD" }],
  suppliers: [{ kind: "hotel", bookingId: "b-1", confirmation: "ABC123" }],
  ...overrides,
});

describe("bookingRecordFor", () => {
  it("keeps what is needed to answer a dispute and the code people quoted", () => {
    expect(bookingRecordFor(source())).toEqual({
      planId: "7f3a2c11-0000-4000-8000-000000000000",
      reference: "UN-7F3A2C",
      planTitle: "Bangkok 3-night hotel stay",
      city: "Bangkok",
      departDate: "2026-12-15",
      returnDate: "2026-12-18",
      payments: [{ payerName: "Maya", paymentId: "pi_1", approvedMinor: 6_369, chargedMinor: 6_369, currency: "USD" }],
      suppliers: [{ kind: "hotel", bookingId: "b-1", confirmation: "ABC123" }],
      purgeAfter: "2028-06-10",
    });
  });

  it("counts a trip with no dates from the day it was made", () => {
    expect(bookingRecordFor(source({ departDate: null, returnDate: null })).purgeAfter).toBe("2028-04-22");
  });

  it("holds no chat, contact or card details, only the fields above", () => {
    expect(Object.keys(bookingRecordFor(source())).sort()).toEqual(["city", "departDate", "payments", "planId", "planTitle", "purgeAfter", "reference", "returnDate", "suppliers"]);
    expect(Object.keys(bookingRecordFor(source()).payments[0]).sort()).toEqual(["approvedMinor", "chargedMinor", "currency", "payerName", "paymentId"]);
  });
});
