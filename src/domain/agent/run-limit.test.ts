import { describe, expect, it } from "vitest";
import { MESSAGES } from "./announce";
import { RUN_LIMITS, startAgentRun } from "./run-agent";
import { FakeMessages, FakeRuns } from "./test-support";

const GROUP = "group-1";
const NOW = new Date("2026-10-27T12:00:00Z");
const minutesAgo = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);

function setup() {
  const runs = new FakeRuns();
  const messages = new FakeMessages();
  const call = (id: string, memberId: string | null = "ana", groupId = GROUP) => startAgentRun({ runs, messages, clock: () => NOW }, { id, groupId, memberId });
  const busyHour = (count: number, memberId: string | null, at = minutesAgo(10), groupId = GROUP) => {
    for (let i = 0; i < count; i += 1) runs.history.push({ groupId, memberId, at });
  };
  return { runs, messages, call, busyHour };
}

describe("calling the agent too often", () => {
  it("lets a person call it up to the limit and not beyond", async () => {
    const justUnder = setup();
    justUnder.busyHour(RUN_LIMITS.perMember - 1, "ana");
    expect(await justUnder.call("m-1")).toMatchObject({ ok: true, value: { status: "started" } });
    expect(justUnder.messages.agentMessages).toHaveLength(0);

    const atLimit = setup();
    atLimit.busyHour(RUN_LIMITS.perMember, "ana");
    expect(await atLimit.call("m-2")).toEqual({ ok: true, value: { status: "limited" } });
    expect(atLimit.runs.started).toHaveLength(0);
    expect(atLimit.messages.agentMessages.at(-1)?.body).toBe(MESSAGES.limited);
  });

  it("does not hold one person's calls against someone else in the group", async () => {
    const { call, busyHour } = setup();
    busyHour(RUN_LIMITS.perMember, "ana");
    expect(await call("m-3", "ben")).toMatchObject({ ok: true, value: { status: "started" } });
  });

  it("stops the whole group at its own limit, whoever asks", async () => {
    const { call, busyHour } = setup();
    for (const person of ["ana", "ben", "cy"]) busyHour(RUN_LIMITS.perGroup / 3, person);
    expect(await call("m-4", "dee")).toEqual({ ok: true, value: { status: "limited" } });
  });

  it("forgets calls from more than an hour ago, and other groups' calls", async () => {
    const { call, busyHour } = setup();
    busyHour(RUN_LIMITS.perGroup, "ana", minutesAgo(61));
    busyHour(RUN_LIMITS.perGroup, "ana", minutesAgo(5), "another-group");
    expect(await call("m-5")).toMatchObject({ ok: true, value: { status: "started" } });
  });

  it("asks nothing of a message with no sender beyond the group limit", async () => {
    const { call, busyHour } = setup();
    busyHour(RUN_LIMITS.perMember, null);
    expect(await call("m-6", null)).toMatchObject({ ok: true, value: { status: "started" } });
  });
});
