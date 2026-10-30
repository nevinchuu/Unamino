import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import type { Member, Message } from "@/domain/group/types";
import type { PlanStatus } from "@/domain/plan/statuses";
import { flight, hotel } from "@/domain/plan/test-support";
import type { PlanViewRaw, ViewMember } from "@/domain/plan/view-store";
import { runRemind, type RemindDeps } from "./remind";

const GROUP = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const PLAN = "3f2b8c1e-5a4d-4e0b-9c7a-1d2e3f4a5b6c";
const NOW = new Date("2026-11-01T10:00:00Z");
const ana: Member = { id: "ana", groupId: GROUP, displayName: "Ana", currency: "USD", isOrganiser: true };

const person = (id: string, name: string, overrides: Partial<ViewMember> = {}): ViewMember => ({ id, name, currency: "USD", planAgreement: "pending", approval: "pending", approvedMinor: null, chargedMinor: null, holdPlaced: false, ...overrides });

const raw = (status: PlanStatus, members: ViewMember[], groupId = GROUP): PlanViewRaw => ({
  id: PLAN, groupId, title: "Bangkok", summary: null, status, deadlineAt: new Date("2026-11-02T00:00:00Z"), baseCurrency: "USD", fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} },
  headcount: members.length, replacedByPlanId: null, trip: { city: "Bangkok", departDate: "2026-12-15", returnDate: "2026-12-18" }, members,
  picks: [{ id: "p1", offer: hotel(), memberIds: members.map((m) => m.id), reason: "r", notes: {} }, { id: "p2", offer: flight(), memberIds: members.map((m) => m.id), reason: "r", notes: {} }], ideas: [], covers: [], bookings: [],
});

const message = (body: string, secondsAgo: number, kind: Message["kind"] = "system"): Message => ({ id: "m", seq: 1, groupId: GROUP, memberId: null, kind, body, replyToMessageId: null, mentionsAgent: false, planId: null, createdAt: new Date(NOW.getTime() - secondsAgo * 1000) });

function setup(plan: PlanViewRaw | "missing" | "down", recent: Message[] = []) {
  const posted: string[] = [];
  const deps: RemindDeps = {
    views: { load: async () => (plan === "missing" ? err({ code: "not_found" as const, message: "none" }) : plan === "down" ? err({ code: "unavailable" as const, message: "db" }) : ok(plan)) },
    messages: {
      recent: async () => recent,
      postSystem: async (_group, body) => (posted.push(body), ok(message(body, 0))),
    },
    clock: () => NOW,
  };
  return { deps, posted };
}

const input = { groupId: GROUP, planId: PLAN };
const agreed = { planAgreement: "agreed" } as const;

describe("runRemind", () => {
  it("nudges the people who have not agreed, naming the sender", async () => {
    const { deps, posted } = setup(raw("reviewing", [person("ana", "Ana", agreed), person("ben", "Ben"), person("cai", "Cai")]));
    expect(await runRemind(deps, ana, input)).toEqual({ ok: true });
    expect(posted).toEqual(["Ana is waiting for Ben and Cai to agree to the plan."]);
  });

  it("nudges for the amount and the card once the plan is being paid for", async () => {
    const { deps, posted } = setup(raw("approving", [person("ana", "Ana", { ...agreed, holdPlaced: true }), person("ben", "Ben", agreed)]));
    expect(await runRemind(deps, ana, input)).toEqual({ ok: true });
    expect(posted).toEqual(["Ana is waiting for Ben to approve their amount and add a card."]);
  });

  it("asks the sender to do their own part first", async () => {
    const { deps, posted } = setup(raw("reviewing", [person("ana", "Ana"), person("ben", "Ben")]));
    expect(await runRemind(deps, ana, input)).toEqual({ ok: false, error: "Do your own part first, then remind the others." });
    expect(posted).toEqual([]);
  });

  it("says so when everyone has done their part", async () => {
    const { deps } = setup(raw("reviewing", [person("ana", "Ana", agreed), person("ben", "Ben", agreed)]));
    expect(await runRemind(deps, ana, input)).toEqual({ ok: false, error: "Everyone has done their part." });
  });

  it.each<PlanStatus>(["held", "booking", "booked", "captured", "expired"])("has nobody to remind once the plan is %s", async (status) => {
    const { deps, posted } = setup(raw(status, [person("ana", "Ana", agreed), person("ben", "Ben")]));
    expect((await runRemind(deps, ana, input)).ok).toBe(false);
    expect(posted).toEqual([]);
  });

  it("holds a second reminder back for a few minutes, from anyone, and allows one after that", async () => {
    const plan = raw("reviewing", [person("ana", "Ana", agreed), person("ben", "Ben")]);
    const justNow = setup(plan, [message("Cai is waiting for Ben to agree to the plan.", 60)]);
    expect(await runRemind(justNow.deps, ana, input)).toEqual({ ok: false, error: "A reminder went out a moment ago. Give them a few minutes." });
    expect(justNow.posted).toEqual([]);

    const longAgo = setup(plan, [message("Cai is waiting for Ben to agree to the plan.", 10 * 60)]);
    expect(await runRemind(longAgo.deps, ana, input)).toEqual({ ok: true });
  });

  it("is not held back by an ordinary message that happens to be recent", async () => {
    const { deps } = setup(raw("reviewing", [person("ana", "Ana", agreed), person("ben", "Ben")]), [message("hello", 5, "human"), message("Ben joined.", 5)]);
    expect(await runRemind(deps, ana, input)).toEqual({ ok: true });
  });

  it("is for people who are signed in to this group and in this plan, and answers like a missing plan otherwise", async () => {
    const plan = raw("reviewing", [person("ana", "Ana", agreed), person("ben", "Ben")]);
    const { deps, posted } = setup(plan);
    expect(await runRemind(deps, null, input)).toEqual({ ok: false, error: "Open your invite link to rejoin this group." });
    expect(await runRemind(deps, { ...ana, groupId: "other" }, input)).toEqual({ ok: false, error: "Open your invite link to rejoin this group." });
    expect(await runRemind(deps, { ...ana, id: "stranger" }, input)).toEqual({ ok: false, error: "You're not part of this plan." });
    expect(await runRemind(deps, ana, { ...input, planId: "not-an-id" })).toEqual({ ok: false, error: "We couldn't find that plan." });
    expect(await runRemind(setup(raw("reviewing", [person("ana", "Ana", agreed)], "another-group")).deps, ana, input)).toEqual({ ok: false, error: "We couldn't find that plan." });
    expect(await runRemind(setup("missing").deps, ana, input)).toEqual({ ok: false, error: "We couldn't find that plan." });
    expect(posted).toEqual([]);
  });

  it("tells a store failure apart from a missing plan", async () => {
    expect(await runRemind(setup("down").deps, ana, input)).toEqual({ ok: false, error: "Something went wrong on our side. Try again in a moment." });
  });
});
