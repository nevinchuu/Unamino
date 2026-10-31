import { describe, expect, it } from "vitest";
import { bookingFailedLine, failureSummary, undoneSentence } from "./announce";
import { BOOKING_FAILURE_KINDS, FAILURE_CAUSES, isRetryable, shortName, type FailedPart } from "./failure";

const part = (overrides: Partial<FailedPart> = {}): FailedPart => ({ pickId: "p", kind: "hotel", title: "Riverside Hotel", listingId: "l", offeredMinor: 100, currency: "USD", ...overrides });

describe("shortName", () => {
  it("keeps a short title as it is", () => {
    expect(shortName("Riverside Hotel")).toBe("Riverside Hotel");
  });

  it("drops the address and landmarks a listing adds after a dash", () => {
    expect(shortName("The Quarter Hualamphong by UHG - Close to Song Wat Road, Chinatown, Hua Lamphong Railway Station")).toBe("The Quarter Hualamphong by UHG");
  });

  it("cuts a very long name, and never returns nothing", () => {
    expect(shortName("A".repeat(80))).toBe(`${"A".repeat(49)}…`);
    expect(shortName(" - odd")).toBe("- odd");
    expect(shortName("   ")).toBe("");
  });
});

describe("isRetryable", () => {
  it("is true only for a supplier that could not be reached", () => {
    expect(BOOKING_FAILURE_KINDS.filter(isRetryable)).toEqual(["temporary"]);
  });
});

describe("undoneSentence", () => {
  it("is null when nothing had been booked", () => {
    expect(undoneSentence([])).toBeNull();
  });
});

describe("bookingFailedLine", () => {
  it("names the part and why, and says nobody was charged", () => {
    expect(bookingFailedLine({ reason: "price", part: part(), undone: [] })).toBe("The hotel Riverside Hotel could not be booked because its price went up. Nothing was charged and every card hold was let go. Mention @trippy to plan again.");
  });

  it("offers to try the same plan again only when the supplier could not be reached", () => {
    expect(bookingFailedLine({ reason: "temporary", part: part(), undone: [] })).toContain("or to try the same plan once more");
    expect(bookingFailedLine({ reason: "unavailable", part: part(), undone: [] })).not.toContain("once more");
  });

  it("says what had been booked and was cancelled, in the singular and the plural", () => {
    expect(bookingFailedLine({ reason: "unavailable", part: part({ kind: "flight", title: "SIN to BKK" }), undone: [{ kind: "hotel", title: "Riverside Hotel" }] })).toContain("The hotel Riverside Hotel had already been booked and was cancelled.");
    expect(bookingFailedLine({ reason: "deadline", part: null, undone: [{ kind: "hotel", title: "A" }, { kind: "flight", title: "B" }] })).toContain("The hotel A and flight B had already been booked and were cancelled.");
  });

  it("has a plain line for every reason when no single part is to blame", () => {
    for (const reason of BOOKING_FAILURE_KINDS) {
      const line = bookingFailedLine({ reason, part: null, undone: [] });
      expect(line).toContain("Nothing was charged and every card hold was let go.");
      expect(line).toContain("@trippy");
    }
  });

  it("says what the partner's answer said when it said more than no, in a fixed sentence per cause", () => {
    for (const cause of FAILURE_CAUSES) {
      const line = bookingFailedLine({ reason: "rejected", cause, part: part(), undone: [] });
      expect(line).toContain("The hotel Riverside Hotel could not be booked because ");
      expect(line).not.toContain("the booking partner refused it");
    }
    expect(bookingFailedLine({ reason: "rejected", cause: "meal_plan_changed", part: part(), undone: [] })).toContain("because the hotel changed the meal plan on that room");
  });

  it("says when the problem is on our side, so nobody doubts their card or details", () => {
    expect(failureSummary({ reason: "rejected", cause: "access_refused", part: part() })).toContain("a problem on our side and not with your card or details");
  });

  it("keeps the old reason when there is no cause", () => {
    expect(failureSummary({ reason: "rejected", cause: null, part: part() })).toBe("The hotel Riverside Hotel could not be booked because the booking partner refused it.");
  });

  it("falls back to a plain reason for a part that failed for none of the usual ones", () => {
    expect(bookingFailedLine({ reason: "other", part: part(), undone: [] })).toContain("because something went wrong.");
  });
});
