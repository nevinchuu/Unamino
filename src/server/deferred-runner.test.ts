import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "@/lib/result";
import type { EffectError, EffectRunner } from "@/domain/plan/effects";
import type { PlanEffect } from "@/domain/plan/types";
import { DeferredBookingRunner } from "./deferred-runner";

class Inner implements EffectRunner {
  readonly calls: readonly PlanEffect[][] = [];
  constructor(private readonly behave: () => Result<void, EffectError> = () => ok(undefined)) {}
  async run(_planId: string, _version: number, effects: readonly PlanEffect[]): Promise<Result<void, EffectError>> {
    (this.calls as PlanEffect[][]).push([...effects]);
    return this.behave();
  }
}

function setup(inner: Inner) {
  const tasks: (() => Promise<unknown>)[] = [];
  const runner = new DeferredBookingRunner(inner, (task) => { tasks.push(task); });
  return { runner, tasks };
}

describe("DeferredBookingRunner", () => {
  it("hands the booking over without doing it, and does it when the task runs", async () => {
    const inner = new Inner();
    const { runner, tasks } = setup(inner);
    expect(await runner.run("plan-1", 3, [{ type: "book" }])).toEqual(ok(undefined));
    expect(inner.calls).toEqual([]);

    await tasks[0]();
    expect(inner.calls).toEqual([[{ type: "book" }]]);
  });

  it("passes on only the request to book", async () => {
    const inner = new Inner();
    const { runner, tasks } = setup(inner);
    await runner.run("plan-1", 3, [{ type: "release_holds", memberIds: ["ana"] }, { type: "book" }]);
    await tasks[0]();
    expect(inner.calls).toEqual([[{ type: "book" }]]);
  });

  it("does nothing when there is nothing to book", async () => {
    const { runner, tasks } = setup(new Inner());
    await runner.run("plan-1", 3, [{ type: "release_holds", memberIds: ["ana"] }]);
    expect(tasks).toEqual([]);
  });

  it("does not let a failed or crashed booking escape the task", async () => {
    const failed = setup(new Inner(() => err({ message: "nope" })));
    await failed.runner.run("plan-1", 3, [{ type: "book" }]);
    await expect(failed.tasks[0]()).resolves.toBeUndefined();

    const crashed = setup(new Inner(() => { throw new Error("boom"); }));
    await crashed.runner.run("plan-1", 3, [{ type: "book" }]);
    await expect(crashed.tasks[0]()).resolves.toBeUndefined();
  });
});
