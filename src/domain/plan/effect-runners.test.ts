import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "@/lib/result";
import { ChatEffectRunner, chatLineFor, type ChatEffectDeps } from "./chat-effects";
import { CompositeEffectRunner, type EffectError, type EffectRunner } from "./effects";
import type { RepositoryError } from "./repository";
import { SimulatedHoldRunner } from "./simulated-holds";
import { approved, DEADLINE, MemoryEffectRunner, MemoryPlanRepository, memberSnapshot } from "./test-support";
import type { PlanEffect } from "./types";

const NOW = new Date("2026-10-27T01:00:00.000Z");

/** Remembers what it was asked, and can be made to fail. */
class Spy implements EffectRunner {
  readonly calls: { planId: string; version: number; effects: readonly PlanEffect[] }[] = [];
  constructor(private readonly failure: EffectError | null = null) {}
  async run(planId: string, version: number, effects: readonly PlanEffect[]): Promise<Result<void, EffectError>> {
    this.calls.push({ planId, version, effects });
    return this.failure ? err(this.failure) : ok(undefined);
  }
}

describe("CompositeEffectRunner", () => {
  const effects: PlanEffect[] = [{ type: "request_approval", memberIds: ["ana"] }];

  it("gives every runner the same effects", async () => {
    const [a, b] = [new Spy(), new Spy()];
    expect(await new CompositeEffectRunner([a, b]).run("plan-1", 4, effects)).toEqual({ ok: true, value: undefined });
    expect(a.calls).toEqual([{ planId: "plan-1", version: 4, effects }]);
    expect(b.calls).toEqual(a.calls);
  });

  it("keeps going when one fails, and reports every failure", async () => {
    const [first, last] = [new Spy({ message: "disk full" }), new Spy({ message: "chat down" })];
    const middle = new Spy();
    const result = await new CompositeEffectRunner([first, middle, last]).run("plan-1", 1, effects);
    expect(result).toEqual({ ok: false, error: { message: "disk full; chat down" } });
    expect(middle.calls).toHaveLength(1);
  });

  it("does nothing, successfully, with no runners", async () => {
    expect(await new CompositeEffectRunner([]).run("plan-1", 1, effects)).toEqual({ ok: true, value: undefined });
  });
});

describe("chatLineFor", () => {
  const names = new Map([["ben", "Ben"]]);

  it("tells the group when they need to come back to the plan", () => {
    expect(chatLineFor({ type: "request_review", memberIds: ["ana"] }, names)).toMatch(/look at it again/);
    expect(chatLineFor({ type: "request_approval", memberIds: ["ana"] }, names)).toMatch(/Everyone agreed.*approves their own amount/);
    expect(chatLineFor({ type: "book" }, names)).toMatch(/Everyone has approved/);
  });

  it("names the person whose price went past their cap, and says someone if it cannot", () => {
    expect(chatLineFor({ type: "request_reapproval", memberId: "ben", newAmountMinor: 35_000 }, names)).toBe("Ben's price went up past the amount they approved, so they need to approve again.");
    expect(chatLineFor({ type: "request_reapproval", memberId: "gone", newAmountMinor: 35_000 }, names)).toMatch(/^Someone's price/);
  });

  it("says nothing about holds, which are between a person and their card", () => {
    expect(chatLineFor({ type: "place_hold", memberId: "ana", amountMinor: 1 }, names)).toBeNull();
    expect(chatLineFor({ type: "release_holds", memberIds: ["ana"] }, names)).toBeNull();
  });

  it("tells the group when everyone was charged, and says so when the booking was only pretended", () => {
    const charge: PlanEffect = { type: "capture_holds", captures: [{ memberId: "ana", captureMinor: 25_000, releaseMinor: 5_000 }] };
    expect(chatLineFor(charge, names)).toBe("Booked. Each person was charged their share, and the rest of their hold was let go.");
    expect(chatLineFor(charge, names, { demoBooking: true })).toBe("Booked. Each person was charged their share, and the rest of their hold was let go. Demo: nothing was really booked.");
  });

  it("never puts an amount or a card detail in the chat", () => {
    const lines = ([{ type: "request_reapproval", memberId: "ben", newAmountMinor: 35_000 }, { type: "request_approval", memberIds: ["ben"] }] as PlanEffect[]).map((effect) => chatLineFor(effect, names));
    expect(lines.join(" ")).not.toMatch(/\d{3}|\$/);
  });
});

describe("ChatEffectRunner", () => {
  function setup(overrides: Partial<ChatEffectDeps> = {}) {
    const posted: { group: string; body: string }[] = [];
    let nameLookups = 0;
    const deps: ChatEffectDeps = {
      groupIdOf: async (planId) => ok(planId === "plan-1" ? "group-1" : null),
      memberNames: async () => (nameLookups += 1, new Map([["ben", "Ben"]])),
      messages: { postSystem: async (group, body) => (posted.push({ group, body }), ok({ id: "m", seq: 1, groupId: group, memberId: null, kind: "system" as const, body, replyToMessageId: null, mentionsAgent: false, planId: null, createdAt: NOW })) },
      ...overrides,
    };
    return { runner: new ChatEffectRunner(deps), posted, lookups: () => nameLookups };
  }

  it("posts a line in the plan's group for each effect that needs one, in order", async () => {
    const { runner, posted } = setup();
    const result = await runner.run("plan-1", 3, [{ type: "request_approval", memberIds: ["ana", "ben"] }, { type: "place_hold", memberId: "ana", amountMinor: 1 }, { type: "book" }]);
    expect(result.ok).toBe(true);
    expect(posted.map((p) => p.group)).toEqual(["group-1", "group-1"]);
    expect(posted[0].body).toMatch(/Everyone agreed/);
    expect(posted[1].body).toMatch(/Everyone has approved/);
  });

  it("posts nothing, and looks nothing up, when no effect needs the chat", async () => {
    const { runner, posted, lookups } = setup({ groupIdOf: async () => { throw new Error("should not be asked"); } });
    expect((await runner.run("plan-1", 1, [{ type: "release_holds", memberIds: ["ana"] }])).ok).toBe(true);
    expect(posted).toEqual([]);
    expect(lookups()).toBe(0);
  });

  it("looks names up only when someone has to be named", async () => {
    const { runner, posted, lookups } = setup();
    await runner.run("plan-1", 1, [{ type: "request_reapproval", memberId: "ben", newAmountMinor: 1 }]);
    expect(lookups()).toBe(1);
    expect(posted[0].body).toMatch(/^Ben's price/);
  });

  it("reports a plan it cannot find a chat for, and a message it cannot post", async () => {
    expect((await setup().runner.run("unknown-plan", 1, [{ type: "request_approval", memberIds: [] }])).ok).toBe(false);
    const failing = setup({ messages: { postSystem: async () => err({ code: "unavailable", message: "db down" }) } });
    expect(await failing.runner.run("plan-1", 1, [{ type: "request_approval", memberIds: [] }])).toEqual({ ok: false, error: { message: "A message could not be posted to the chat" } });
  });
});

describe("SimulatedHoldRunner", () => {
  const plan = (members = [approved("ana"), memberSnapshot("ben", { planAgreement: "agreed", agreedShareMinor: 30_000 })]) =>
    new MemoryPlanRepository({ id: "plan-1", version: 1, plan: { status: "approving", deadlineAt: DEADLINE, hardDeadlineAt: new Date("2026-10-29T00:00:00Z"), members } });
  const hold = (memberId: string): PlanEffect => ({ type: "place_hold", memberId, amountMinor: 30_000 });
  const build = (repo: MemoryPlanRepository, onward: EffectRunner = new MemoryEffectRunner()) => new SimulatedHoldRunner(repo, () => onward, () => NOW);

  it("says the hold was placed, and the plan waits for the others", async () => {
    const repo = plan();
    const onward = new Spy();
    expect(await build(repo, onward).run("plan-1", 2, [hold("ana")])).toEqual({ ok: true, value: undefined });
    expect(repo.plan.members[0].holdPlaced).toBe(true);
    expect(repo.plan.status).toBe("approving");
    expect(onward.calls).toEqual([]);
  });

  it("moves the plan on, and passes on what that sets in motion, when the last hold is in", async () => {
    const repo = plan([approved("ana"), approved("ben", { holdPlaced: true })]);
    const onward = new Spy();
    await build(repo, onward).run("plan-1", 2, [hold("ana")]);
    expect(repo.plan.status).toBe("held");
    expect(onward.calls).toEqual([{ planId: "plan-1", version: 2, effects: [{ type: "book" }] }]);
  });

  it("leaves every other kind of effect alone", async () => {
    const repo = plan();
    await build(repo).run("plan-1", 2, [{ type: "request_approval", memberIds: ["ana"] }, { type: "book" }]);
    expect(repo.saves).toBe(0);
  });

  it("lets go of a hold the plan no longer needs, such as when the person backed out first", async () => {
    const repo = plan([memberSnapshot("ana", { planAgreement: "agreed", agreedShareMinor: 30_000 }), approved("ben")]);
    const onward = new Spy();
    expect(await build(repo, onward).run("plan-1", 2, [hold("ana")])).toEqual({ ok: true, value: undefined });
    expect(repo.saves).toBe(0);
    expect(onward.calls).toEqual([]);
  });

  it("reports a storage failure instead of pretending", async () => {
    const repo = plan();
    const broken = Object.assign(repo, { load: async (): Promise<Result<never, RepositoryError>> => err({ code: "unavailable", message: "db down" }) });
    expect(await build(broken).run("plan-1", 2, [hold("ana")])).toEqual({ ok: false, error: { message: "The simulated hold could not be recorded" } });
  });
});

describe("SimulatedHoldRunner, charging", () => {
  const booked = () =>
    new MemoryPlanRepository({ id: "plan-1", version: 1, plan: { status: "booked", deadlineAt: DEADLINE, hardDeadlineAt: new Date("2026-10-29T00:00:00Z"), members: [approved("ana", { holdPlaced: true, currentShareMinor: 25_000 })] } });
  const charge: PlanEffect = { type: "capture_holds", captures: [{ memberId: "ana", captureMinor: 25_000, releaseMinor: 5_000 }] };

  it("marks the plan paid when asked to charge, since nothing was really held", async () => {
    const repo = booked();
    expect(await new SimulatedHoldRunner(repo, () => new MemoryEffectRunner(), () => NOW).run("plan-1", 3, [charge])).toEqual({ ok: true, value: undefined });
    expect(repo.plan.status).toBe("captured");
    expect(repo.plan.members[0].chargedMinor).toBe(25_000);
  });

  it("is fine when the plan is already paid", async () => {
    const repo = booked();
    const runner = new SimulatedHoldRunner(repo, () => new MemoryEffectRunner(), () => NOW);
    await runner.run("plan-1", 3, [charge]);
    expect(await runner.run("plan-1", 4, [charge])).toEqual({ ok: true, value: undefined });
  });
});
