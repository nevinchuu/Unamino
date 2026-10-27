import { describe, expect, it } from "vitest";
import {
  computeApprovalExpiry,
  computePlanDeadlines,
  DEFAULT_PLAN_WINDOW_MS,
  earliestExpiry,
  renewedDeadline,
} from "./deadline";

const CREATED = new Date("2026-10-27T00:00:00Z");
const at = (iso: string): { expiresAt: string } => ({ expiresAt: iso });
const HARD = new Date(CREATED.getTime() + DEFAULT_PLAN_WINDOW_MS);

describe("earliestExpiry", () => {
  it("finds the soonest expiry", () => {
    expect(earliestExpiry([at("2026-10-27T00:20:00Z"), at("2026-10-27T00:09:00Z")])).toEqual(new Date("2026-10-27T00:09:00Z"));
  });

  it("returns null for no offers", () => {
    expect(earliestExpiry([])).toBeNull();
  });
});

describe("computePlanDeadlines", () => {
  it("follows the earliest offer, with the hard cap 48 hours after creation", () => {
    const result = computePlanDeadlines({ createdAt: CREATED, offers: [at("2026-10-27T00:09:00Z"), at("2026-10-27T01:00:00Z")] });
    expect(result).toEqual({ ok: true, value: { deadlineAt: new Date("2026-10-27T00:09:00Z"), hardDeadlineAt: HARD } });
  });

  it("never sets the deadline past the hard cap", () => {
    const result = computePlanDeadlines({ createdAt: CREATED, offers: [at("2026-12-01T00:00:00Z")] });
    expect(result.ok && result.value.deadlineAt).toEqual(HARD);
  });

  it("accepts a custom window", () => {
    const result = computePlanDeadlines({ createdAt: CREATED, offers: [at("2026-10-27T05:00:00Z")], windowMs: 60 * 60 * 1000 });
    expect(result.ok && result.value.hardDeadlineAt).toEqual(new Date("2026-10-27T01:00:00Z"));
  });

  it("rejects no offers, already expired offers, and a bad window", () => {
    const code = (input: Parameters<typeof computePlanDeadlines>[0]): string | null => {
      const result = computePlanDeadlines(input);
      return result.ok ? null : result.error.code;
    };
    expect(code({ createdAt: CREATED, offers: [] })).toBe("no_offers");
    expect(code({ createdAt: CREATED, offers: [at("2026-10-27T00:00:00Z")] })).toBe("deadline_already_passed");
    expect(code({ createdAt: CREATED, offers: [at("2026-10-26T00:00:00Z")] })).toBe("deadline_already_passed");
    expect(code({ createdAt: CREATED, offers: [at("2026-10-27T01:00:00Z")], windowMs: 0 })).toBe("invalid_window");
    expect(code({ createdAt: CREATED, offers: [at("2026-10-27T01:00:00Z")], windowMs: Number.NaN })).toBe("invalid_window");
  });
});

describe("renewedDeadline", () => {
  const current = new Date("2026-10-27T00:09:00Z");

  it("moves to the earliest new expiry", () => {
    const next = renewedDeadline({ offers: [at("2026-10-27T00:20:00Z"), at("2026-10-27T00:18:00Z")], currentDeadlineAt: current, hardDeadlineAt: HARD });
    expect(next).toEqual(new Date("2026-10-27T00:18:00Z"));
  });

  it("is capped at the hard cap", () => {
    expect(renewedDeadline({ offers: [at("2027-01-01T00:00:00Z")], currentDeadlineAt: current, hardDeadlineAt: HARD })).toEqual(HARD);
  });

  it("returns null when there is nothing to extend", () => {
    expect(renewedDeadline({ offers: [at("2026-10-27T00:09:00Z")], currentDeadlineAt: current, hardDeadlineAt: HARD })).toBeNull();
    expect(renewedDeadline({ offers: [at("2026-10-27T00:05:00Z")], currentDeadlineAt: current, hardDeadlineAt: HARD })).toBeNull();
    expect(renewedDeadline({ offers: [], currentDeadlineAt: current, hardDeadlineAt: HARD })).toBeNull();
    expect(renewedDeadline({ offers: [at("2027-01-01T00:00:00Z")], currentDeadlineAt: HARD, hardDeadlineAt: HARD })).toBeNull();
  });
});

describe("computeApprovalExpiry", () => {
  it("lasts until the plan deadline", () => {
    const deadlineAt = new Date("2026-10-27T00:09:00Z");
    expect(computeApprovalExpiry({ approvedAt: CREATED, deadlineAt })).toEqual({ ok: true, value: deadlineAt });
  });

  it("is refused at or after the deadline", () => {
    const deadlineAt = new Date("2026-10-27T00:09:00Z");
    const result = computeApprovalExpiry({ approvedAt: deadlineAt, deadlineAt });
    expect(result.ok ? null : result.error.code).toBe("deadline_already_passed");
  });
});
