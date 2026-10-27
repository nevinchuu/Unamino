import { describe, expect, it } from "vitest";
import type { Hold } from "./types";
import { checkHold } from "./verify";

const OWNER = { planId: "plan-1", memberId: "ana" };
const EXPECTED = { owner: OWNER, amountMinor: 29_009, currency: "USD" };

const hold = (overrides: Partial<Hold> = {}): Hold => ({ id: "pi_1", status: "held", amountMinor: 29_009, heldMinor: 29_009, chargedMinor: 0, currency: "USD", owner: OWNER, clientSecret: null, lastError: null, ...overrides });

describe("checkHold", () => {
  it("accepts a hold that is held in full, for this member, in this plan, for the amount they approved", () => {
    expect(checkHold(hold(), EXPECTED)).toEqual({ ok: true });
  });

  it("does not care about the letter case of the currency, which providers write in lower case", () => {
    expect(checkHold(hold({ currency: "usd" }), EXPECTED)).toEqual({ ok: true });
  });

  it("refuses a hold that belongs to someone else, or to another plan", () => {
    expect(checkHold(hold({ owner: { planId: "plan-1", memberId: "ben" } }), EXPECTED)).toEqual({ ok: false, reason: "wrong_owner" });
    expect(checkHold(hold({ owner: { planId: "plan-2", memberId: "ana" } }), EXPECTED)).toEqual({ ok: false, reason: "wrong_owner" });
  });

  it("refuses a hold for a different amount, higher or lower, and in a different currency", () => {
    expect(checkHold(hold({ amountMinor: 29_010 }), EXPECTED)).toEqual({ ok: false, reason: "wrong_amount" });
    expect(checkHold(hold({ amountMinor: 100, heldMinor: 100 }), EXPECTED)).toEqual({ ok: false, reason: "wrong_amount" });
    expect(checkHold(hold({ currency: "SGD" }), EXPECTED)).toEqual({ ok: false, reason: "wrong_currency" });
  });

  it.each(["awaiting_card", "captured", "released"] as const)("refuses a hold that is %s, because nothing is set aside", (status) => {
    expect(checkHold(hold({ status, heldMinor: 0 }), EXPECTED)).toEqual({ ok: false, reason: "not_held" });
  });

  it("refuses a hold that says held but sets aside less than the amount", () => {
    expect(checkHold(hold({ heldMinor: 1 }), EXPECTED)).toEqual({ ok: false, reason: "not_held" });
  });

  it("checks who it belongs to before anything else, so a stranger's hold reveals nothing about its state", () => {
    expect(checkHold(hold({ owner: { planId: "x", memberId: "y" }, status: "awaiting_card", heldMinor: 0, amountMinor: 1 }), EXPECTED)).toEqual({ ok: false, reason: "wrong_owner" });
  });
});
