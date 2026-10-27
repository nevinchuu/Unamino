import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "@/lib/result";
import type { PlanEffect } from "@/domain/plan/types";
import type { HoldFailure } from "./hold-service";
import type { EffectOutcome } from "@/domain/plan/effect-log";
import { PaymentEffectRunner } from "./payment-effects";

type Outcome = Result<unknown, HoldFailure>;

function setup(overrides: { ensure?: Outcome; release?: Outcome; capture?: Outcome } = {}) {
  const calls: unknown[][] = [];
  const holds = {
    ensureHold: async (...args: unknown[]) => (calls.push(["ensureHold", ...args]), overrides.ensure ?? ok({})),
    releaseHolds: async (...args: unknown[]) => (calls.push(["releaseHolds", ...args]), overrides.release ?? ok(undefined)),
    captureHolds: async (...args: unknown[]) => (calls.push(["captureHolds", ...args]), overrides.capture ?? ok(undefined)),
  } as unknown as ConstructorParameters<typeof PaymentEffectRunner>[0];
  return { runner: new PaymentEffectRunner(holds), calls };
}

const CAPTURES = [{ memberId: "ana", captureMinor: 25_000, releaseMinor: 5_000 }];

describe("PaymentEffectRunner", () => {
  it("makes a hold when someone approves, lets go when asked, and charges when asked", async () => {
    const { runner, calls } = setup();
    const effects: PlanEffect[] = [{ type: "place_hold", memberId: "ana", amountMinor: 30_000 }, { type: "release_holds", memberIds: ["ben"] }, { type: "capture_holds", captures: CAPTURES }];
    expect(await runner.run("plan-1", 4, effects)).toEqual({ ok: true, value: undefined });
    expect(calls).toEqual([["ensureHold", "plan-1", "ana"], ["releaseHolds", "plan-1", ["ben"]], ["captureHolds", "plan-1", CAPTURES]]);
  });

  it("ignores the amount in a hold request, because the hold is made for what is stored as approved", async () => {
    const { runner, calls } = setup();
    await runner.run("plan-1", 1, [{ type: "place_hold", memberId: "ana", amountMinor: 999_999 }]);
    expect(calls).toEqual([["ensureHold", "plan-1", "ana"]]);
  });

  it("leaves effects that are not about money alone", async () => {
    const { runner, calls } = setup();
    const result = await runner.run("plan-1", 1, [{ type: "request_review", memberIds: ["ana"] }, { type: "request_approval", memberIds: ["ana"] }, { type: "request_reapproval", memberId: "ana", newAmountMinor: 1 }, { type: "book" }]);
    expect(result.ok).toBe(true);
    expect(calls).toEqual([]);
  });

  it("does not call a hold that is not needed a failure", async () => {
    const { runner } = setup({ ensure: err({ kind: "not_applicable", message: "no hold needed" }) });
    expect((await runner.run("plan-1", 1, [{ type: "place_hold", memberId: "ana", amountMinor: 1 }])).ok).toBe(true);
  });

  it("reports every failure, and still does the rest", async () => {
    const { runner, calls } = setup({ release: err({ kind: "payment", message: "stripe is down" }), capture: err({ kind: "payment", message: "capture refused" }) });
    const result = await runner.run("plan-1", 1, [{ type: "release_holds", memberIds: ["ana"] }, { type: "place_hold", memberId: "ben", amountMinor: 1 }, { type: "capture_holds", captures: CAPTURES }]);
    expect(result).toEqual({ ok: false, error: { message: "stripe is down; capture refused" } });
    expect(calls.map((c) => c[0])).toEqual(["releaseHolds", "ensureHold", "captureHolds"]);
  });

  it("reports a hold that could not be made, because the card form will have to make it", async () => {
    const { runner } = setup({ ensure: err({ kind: "payment", message: "stripe is down" }) });
    expect(await runner.run("plan-1", 1, [{ type: "place_hold", memberId: "ana", amountMinor: 1 }])).toEqual({ ok: false, error: { message: "stripe is down" } });
  });
});

describe("PaymentEffectRunner, writing down how it went", () => {
  function withLog(overrides: Parameters<typeof setup>[0] = {}) {
    const finished: [string, EffectOutcome][] = [];
    const calls: unknown[][] = [];
    const holds = {
      ensureHold: async () => overrides.ensure ?? ok({}),
      releaseHolds: async () => overrides.release ?? ok(undefined),
      captureHolds: async () => overrides.capture ?? ok(undefined),
    } as unknown as ConstructorParameters<typeof PaymentEffectRunner>[0];
    return { runner: new PaymentEffectRunner(holds, { finish: async (key, outcome) => void (finished.push([key, outcome]), calls.push([key])) }), finished };
  }

  it("marks each money effect done under its own name, and leaves messages and bookings alone", async () => {
    const { runner, finished } = withLog();
    await runner.run("plan-1", 7, [{ type: "request_approval", memberIds: [] }, { type: "release_holds", memberIds: ["ana"] }, { type: "book" }, { type: "capture_holds", captures: CAPTURES }]);
    expect(finished).toEqual([["plan-1:7:1", { status: "done" }], ["plan-1:7:3", { status: "done" }]]);
  });

  it("marks one that failed with the reason, so it can be tried again", async () => {
    const { runner, finished } = withLog({ capture: err({ kind: "payment", message: "stripe is down" }) });
    await runner.run("plan-1", 2, [{ type: "capture_holds", captures: CAPTURES }]);
    expect(finished).toEqual([["plan-1:2:0", { status: "failed", error: "stripe is down" }]]);
  });

  it("counts a hold that was not needed as done, not as something to retry", async () => {
    const { runner, finished } = withLog({ ensure: err({ kind: "not_applicable", message: "no hold needed" }) });
    await runner.run("plan-1", 2, [{ type: "place_hold", memberId: "ana", amountMinor: 1 }]);
    expect(finished).toEqual([["plan-1:2:0", { status: "done" }]]);
  });

  it("can do one effect on its own for a retry, and says what went wrong", async () => {
    expect(await withLog().runner.runEffect("plan-1", { type: "release_holds", memberIds: ["ana"] })).toBeNull();
    expect(await withLog({ release: err({ kind: "payment", message: "refused" }) }).runner.runEffect("plan-1", { type: "release_holds", memberIds: ["ana"] })).toBe("refused");
    expect(await withLog().runner.runEffect("plan-1", { type: "request_review", memberIds: [] })).toBeNull();
  });
});
