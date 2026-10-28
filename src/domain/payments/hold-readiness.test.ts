import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import type { HoldRecord, HoldStore } from "./hold-store";
import { ProviderHoldReadiness } from "./hold-readiness";
import type { Hold, PaymentProvider } from "./types";

const record = (memberId: string, overrides: Partial<HoldRecord> = {}): HoldRecord => ({
  planId: "plan-1", memberId, currency: "USD", planStatus: "held", approval: "approved", approvedMinor: 30_000, holdPlaced: true, holdId: `hold-${memberId}`, holdAttempt: 0, ...overrides,
});

const hold = (memberId: string, overrides: Partial<Hold> = {}): Hold => ({
  id: `hold-${memberId}`, status: "held", amountMinor: 30_000, heldMinor: 30_000, chargedMinor: 0, currency: "USD", owner: { planId: "plan-1", memberId }, clientSecret: null, lastError: null, ...overrides,
});

function checker(records: Record<string, HoldRecord | "down">, holds: Record<string, Hold | "down">) {
  const store: Pick<HoldStore, "find"> = {
    find: async (_planId, memberId) => {
      const found = records[memberId];
      return found === "down" ? err({ code: "unavailable", message: "db down" }) : found ? ok(found) : err({ code: "not_found", message: "no member" });
    },
  };
  const provider: Pick<PaymentProvider, "getHold"> = {
    getHold: async (holdId) => {
      const found = holds[holdId];
      return found === "down" ? err({ code: "unavailable", message: "stripe down" }) : found ? ok(found) : err({ code: "not_found", message: "no hold" });
    },
  };
  return new ProviderHoldReadiness(store, provider);
}

describe("ProviderHoldReadiness", () => {
  it("is ready when every hold is held in full for what the person approved", async () => {
    const ready = checker({ ana: record("ana"), ben: record("ben") }, { "hold-ana": hold("ana"), "hold-ben": hold("ben") });
    expect(await ready.problem("plan-1", ["ana", "ben"])).toEqual(ok(null));
  });

  it("names the problem when a hold was let go of", async () => {
    const ready = checker({ ana: record("ana") }, { "hold-ana": hold("ana", { status: "released", heldMinor: 0 }) });
    expect(await ready.problem("plan-1", ["ana"])).toEqual(ok("a member's hold is not usable (not_held)"));
  });

  it("names the problem when a hold is for a different amount than was approved", async () => {
    const ready = checker({ ana: record("ana") }, { "hold-ana": hold("ana", { amountMinor: 20_000, heldMinor: 20_000 }) });
    expect(await ready.problem("plan-1", ["ana"])).toEqual(ok("a member's hold is not usable (wrong_amount)"));
  });

  it("names the problem when a member has no hold at all", async () => {
    const ready = checker({ ana: record("ana", { holdId: null }) }, {});
    expect(await ready.problem("plan-1", ["ana"])).toEqual(ok("a member has no hold"));
  });

  it("says it could not check when the store or the provider is down", async () => {
    expect((await checker({ ana: "down" }, {}).problem("plan-1", ["ana"])).ok).toBe(false);
    expect((await checker({ ana: record("ana") }, { "hold-ana": "down" }).problem("plan-1", ["ana"])).ok).toBe(false);
  });
});
