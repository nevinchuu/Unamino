import { describe, expect, it } from "vitest";
import { CATCH_UP_GAP_MS, CHARGE_RETRY_GAP_MS, ChargeCatchUp } from "./charge-catch-up";

const SUMMARY = { tried: 1, succeeded: 1, failed: 0, gaveUp: 0 };

function setup() {
  let now = new Date("2026-11-01T10:00:00Z").getTime();
  const asked: unknown[] = [];
  const catchUp = new ChargeCatchUp({ retrier: { retry: async (only) => (asked.push(only), SUMMARY) }, clock: () => new Date(now) });
  return { catchUp, asked, advance: (ms: number) => (now += ms) };
}

describe("ChargeCatchUp", () => {
  it("retries only this plan's charges, leaving a charge that failed a moment ago alone", async () => {
    const { catchUp, asked } = setup();
    expect(await catchUp.catchUp("plan-1")).toEqual(SUMMARY);
    expect(asked).toEqual([{ planId: "plan-1", failedOlderThanMs: CHARGE_RETRY_GAP_MS }]);
  });

  it("leaves a plan alone for a short while after looking at it, then looks again", async () => {
    const { catchUp, asked, advance } = setup();
    await catchUp.catchUp("plan-1");
    advance(CATCH_UP_GAP_MS - 1_000);
    expect(await catchUp.catchUp("plan-1")).toBeNull();
    advance(2_000);
    expect(await catchUp.catchUp("plan-1")).toEqual(SUMMARY);
    expect(asked).toHaveLength(2);
  });

  it("keeps a separate gap for each plan", async () => {
    const { catchUp, asked } = setup();
    await catchUp.catchUp("plan-1");
    await catchUp.catchUp("plan-2");
    expect(asked).toHaveLength(2);
  });
});
