import { describe, expect, it } from "vitest";
import type { EffectOutcome, LoggedEffect } from "@/domain/plan/effect-log";
import type { PlanEffect } from "@/domain/plan/types";
import { EffectRetrier, giveUpLine, MAX_EFFECT_ATTEMPTS } from "./effect-retrier";

const NOW = new Date("2026-10-27T12:00:00Z");
const RELEASE: PlanEffect = { type: "release_holds", memberIds: ["ana"] };
const CAPTURE: PlanEffect = { type: "capture_holds", captures: [{ memberId: "ana", captureMinor: 25_000, releaseMinor: 5_000 }] };
const logged = (key: string, effect: PlanEffect, attempts = 1): LoggedEffect => ({ key, planId: "plan-1", effect, attempts });

function setup(due: LoggedEffect[], failures: Record<string, string> = {}) {
  const finished: [string, EffectOutcome][] = [];
  const ran: [string, PlanEffect][] = [];
  const toldGroup: [string, PlanEffect][] = [];
  let asked: unknown = null;
  const retrier = new EffectRetrier({
    log: {
      finish: async (key, outcome) => void finished.push([key, outcome]),
      retryable: async (input) => ((asked = input), due),
    },
    runner: { runEffect: async (planId, effect) => (ran.push([planId, effect]), failures[JSON.stringify(effect)] ?? null) },
    onGaveUp: async (planId, effect) => void toldGroup.push([planId, effect]),
    clock: () => NOW,
  });
  return { retrier, finished, ran, toldGroup, asked: () => asked };
}

describe("EffectRetrier", () => {
  it("asks for the effects that are due, with the limits it was given", async () => {
    const { retrier, asked } = setup([]);
    await retrier.retry();
    expect(asked()).toEqual({ now: NOW, pendingOlderThanMs: 120_000, maxAttempts: MAX_EFFECT_ATTEMPTS, limit: 25 });
  });

  it("does nothing, and says so, when nothing is due", async () => {
    const { retrier, ran } = setup([]);
    expect(await retrier.retry()).toEqual({ tried: 0, succeeded: 0, failed: 0, gaveUp: 0 });
    expect(ran).toEqual([]);
  });

  it("does each effect again, and writes down that it worked", async () => {
    const { retrier, ran, finished } = setup([logged("k1", RELEASE), logged("k2", CAPTURE, 0)]);
    expect(await retrier.retry()).toEqual({ tried: 2, succeeded: 2, failed: 0, gaveUp: 0 });
    expect(ran).toEqual([["plan-1", RELEASE], ["plan-1", CAPTURE]]);
    expect(finished).toEqual([["k1", { status: "done" }], ["k2", { status: "done" }]]);
  });

  it("writes down why one failed and carries on with the rest, without telling the group yet", async () => {
    const { retrier, finished, toldGroup } = setup([logged("k1", RELEASE, 1), logged("k2", CAPTURE, 1)], { [JSON.stringify(RELEASE)]: "stripe is down" });
    expect(await retrier.retry()).toEqual({ tried: 2, succeeded: 1, failed: 1, gaveUp: 0 });
    expect(finished).toEqual([["k1", { status: "failed", error: "stripe is down" }], ["k2", { status: "done" }]]);
    expect(toldGroup).toEqual([]);
  });

  it("tells the group once, on the last attempt that is allowed, and not before", async () => {
    const failing = { [JSON.stringify(CAPTURE)]: "card refused" };
    const early = setup([logged("k", CAPTURE, MAX_EFFECT_ATTEMPTS - 2)], failing);
    expect((await early.retrier.retry()).gaveUp).toBe(0);
    expect(early.toldGroup).toEqual([]);

    const last = setup([logged("k", CAPTURE, MAX_EFFECT_ATTEMPTS - 1)], failing);
    expect(await last.retrier.retry()).toMatchObject({ failed: 1, gaveUp: 1 });
    expect(last.toldGroup).toEqual([["plan-1", CAPTURE]]);
  });

  it("does not tell the group about an effect that worked on its last attempt", async () => {
    const { retrier, toldGroup } = setup([logged("k", CAPTURE, MAX_EFFECT_ATTEMPTS - 1)]);
    await retrier.retry();
    expect(toldGroup).toEqual([]);
  });
});

describe("giveUpLine", () => {
  it("says plainly what could not be done, and what it means for people's money", () => {
    expect(giveUpLine(CAPTURE)).toMatch(/could not be taken.*Nobody has been charged more than they approved/);
    expect(giveUpLine(RELEASE)).toMatch(/could not be released.*nothing will be charged/);
    expect(giveUpLine({ type: "place_hold", memberId: "ana", amountMinor: 1 })).toMatch(/try again/);
  });

  it("has nothing to say about effects that are not money", () => {
    expect(giveUpLine({ type: "book" })).toBeNull();
    expect(giveUpLine({ type: "request_review", memberIds: [] })).toBeNull();
  });

  it("never puts an amount, a name or a card in the chat", () => {
    const lines = [CAPTURE, RELEASE, { type: "place_hold", memberId: "ana", amountMinor: 29_009 } as PlanEffect].map(giveUpLine).join(" ");
    expect(lines).not.toMatch(/\$|\d{3}|ana|4242/i);
  });
});
