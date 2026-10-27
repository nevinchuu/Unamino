import { describe, expect, it } from "vitest";
import { err, type Result } from "@/lib/result";
import type { EffectError, EffectRunner } from "./effects";
import type { RepositoryError } from "./repository";
import { SimulatedBookingRunner } from "./simulated-booking";
import { approved, DEADLINE, HARD, MemoryPlanRepository, NOW } from "./test-support";
import type { MemberSnapshot, PlanEffect } from "./types";

class Spy implements EffectRunner {
  readonly calls: { version: number; effects: readonly PlanEffect[] }[] = [];
  constructor(private readonly failure: EffectError | null = null) {}
  async run(_planId: string, version: number, effects: readonly PlanEffect[]): Promise<Result<void, EffectError>> {
    this.calls.push({ version, effects });
    return this.failure ? err(this.failure) : { ok: true, value: undefined };
  }
}

const held = (members: MemberSnapshot[] = [approved("ana", { holdPlaced: true, currentShareMinor: 25_000 }), approved("ben", { holdPlaced: true })]) =>
  new MemoryPlanRepository({ id: "plan-1", version: 1, plan: { status: "held", deadlineAt: DEADLINE, hardDeadlineAt: HARD, members } });

describe("SimulatedBookingRunner", () => {
  it("claims the plan, says the booking succeeded, and passes on the request to charge each person's share", async () => {
    const repo = held();
    const onward = new Spy();
    await new SimulatedBookingRunner(repo, () => onward, () => NOW).run("plan-1", 5, [{ type: "book" }]);
    expect(repo.plan.status).toBe("booked");
    expect(onward.calls).toHaveLength(1);
    expect(onward.calls[0].effects).toEqual([
      { type: "capture_holds", captures: [{ memberId: "ana", captureMinor: 25_000, releaseMinor: 5_000 }, { memberId: "ben", captureMinor: 30_000, releaseMinor: 0 }] },
    ]);
  });

  it("leaves every other kind of effect alone", async () => {
    const repo = held();
    const onward = new Spy();
    await new SimulatedBookingRunner(repo, () => onward, () => NOW).run("plan-1", 5, [{ type: "request_approval", memberIds: ["ana"] }, { type: "release_holds", memberIds: ["ana"] }]);
    expect(repo.plan.status).toBe("held");
    expect(onward.calls).toEqual([]);
  });

  it("does nothing when the plan has moved on, such as a second request to book the same plan", async () => {
    const repo = held();
    const onward = new Spy();
    const runner = new SimulatedBookingRunner(repo, () => onward, () => NOW);
    await runner.run("plan-1", 5, [{ type: "book" }]);
    expect(await runner.run("plan-1", 6, [{ type: "book" }])).toEqual({ ok: true, value: undefined });
    expect(onward.calls).toHaveLength(1);
  });

  it("does not book a plan whose time has run out", async () => {
    const repo = held();
    const onward = new Spy();
    await new SimulatedBookingRunner(repo, () => onward, () => new Date(DEADLINE.getTime() + 1)).run("plan-1", 5, [{ type: "book" }]);
    expect(repo.plan.status).toBe("held");
    expect(onward.calls).toEqual([]);
  });

  it("reports a failure of what follows the booking", async () => {
    const result = await new SimulatedBookingRunner(held(), () => new Spy({ message: "stripe is down" }), () => NOW).run("plan-1", 5, [{ type: "book" }]);
    expect(result).toEqual({ ok: false, error: { message: "stripe is down" } });
  });

  it("reports a storage failure instead of pretending", async () => {
    const broken = Object.assign(held(), { load: async (): Promise<Result<never, RepositoryError>> => err({ code: "unavailable", message: "db down" }) });
    expect(await new SimulatedBookingRunner(broken, () => new Spy(), () => NOW).run("plan-1", 5, [{ type: "book" }])).toEqual({ ok: false, error: { message: "The simulated booking could not start" } });
  });
});
