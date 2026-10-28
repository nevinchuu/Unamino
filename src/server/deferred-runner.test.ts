import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import type { EffectRunner } from "@/domain/plan/effects";
import { RecordingEffectRunner } from "@/domain/plan/test-support";
import { DeferredBookingRunner } from "./deferred-runner";

function setup(inner: EffectRunner) {
  const tasks: (() => Promise<unknown>)[] = [];
  const runner = new DeferredBookingRunner(inner, (task) => { tasks.push(task); });
  return { runner, tasks };
}

/** The effects the inner runner was asked to do, one list per request. */
const asked = (inner: RecordingEffectRunner) => inner.calls.map((call) => call.effects);

describe("DeferredBookingRunner", () => {
  it("hands the booking over without doing it, and does it when the task runs", async () => {
    const inner = new RecordingEffectRunner();
    const { runner, tasks } = setup(inner);
    expect(await runner.run("plan-1", 3, [{ type: "book" }])).toEqual(ok(undefined));
    expect(asked(inner)).toEqual([]);

    await tasks[0]();
    expect(asked(inner)).toEqual([[{ type: "book" }]]);
  });

  it("passes on only the request to book", async () => {
    const inner = new RecordingEffectRunner();
    const { runner, tasks } = setup(inner);
    await runner.run("plan-1", 3, [{ type: "release_holds", memberIds: ["ana"] }, { type: "book" }]);
    await tasks[0]();
    expect(asked(inner)).toEqual([[{ type: "book" }]]);
  });

  it("does nothing when there is nothing to book", async () => {
    const { runner, tasks } = setup(new RecordingEffectRunner());
    await runner.run("plan-1", 3, [{ type: "release_holds", memberIds: ["ana"] }]);
    expect(tasks).toEqual([]);
  });

  it("does not let a failed or crashed booking escape the task", async () => {
    const failed = setup({ run: async () => err({ message: "nope" }) });
    await failed.runner.run("plan-1", 3, [{ type: "book" }]);
    await expect(failed.tasks[0]()).resolves.toBeUndefined();

    const crashed = setup({ run: async () => { throw new Error("boom"); } });
    await crashed.runner.run("plan-1", 3, [{ type: "book" }]);
    await expect(crashed.tasks[0]()).resolves.toBeUndefined();
  });
});
