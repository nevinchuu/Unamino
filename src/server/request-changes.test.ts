import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "@/lib/result";
import { FakeMessages, FakeRuns } from "@/domain/agent/test-support";
import { mentionsAgent } from "@/domain/group/mention";
import type { Member, Message } from "@/domain/group/types";
import type { PlanStatus } from "@/domain/plan/statuses";
import type { PlanViewRaw } from "@/domain/plan/view-store";
import { flight, hotel } from "@/domain/plan/test-support";
import { runRequestChanges, type RequestChangesDeps } from "./request-changes";

const GROUP = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const PLAN = "11111111-2222-4333-8444-555555555555";
const ana: Member = { id: "ana", groupId: GROUP, displayName: "Ana", currency: "USD", isOrganiser: false };
const NOW = new Date("2026-10-27T10:00:00Z");

const raw = (status: PlanStatus = "reviewing", groupId = GROUP): PlanViewRaw => ({
  id: PLAN, groupId, title: "Bangkok", summary: null, status, deadlineAt: new Date("2026-10-27T01:09:00Z"), baseCurrency: "USD",
  fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 1, replacedByPlanId: null, trip: { city: "Bangkok", departDate: "2026-12-11", returnDate: "2026-12-13" },
  members: [{ id: "ana", name: "Ana", currency: "USD", planAgreement: "pending", approval: "pending", approvedMinor: null, chargedMinor: null, holdPlaced: false }],
  picks: [{ id: "p1", offer: hotel(), memberIds: ["ana"], reason: "r", notes: {} }, { id: "p2", offer: flight(), memberIds: ["ana"], reason: "r", notes: {} }], ideas: [], bookings: [],
});

function setup(options: { plan?: PlanViewRaw | "missing"; postFails?: boolean } = {}) {
  const posted: string[] = [];
  const plan = options.plan ?? raw();
  const runs = new FakeRuns();
  let seq = 0;
  const deps: RequestChangesDeps = {
    views: { load: async () => (plan === "missing" ? err({ code: "not_found", message: "none" }) : ok(plan)) },
    payments: "none",
    send: {
      messages: {
        post: async (input): Promise<Result<Message, { code: "invalid_input" | "unavailable" | "forbidden"; message: string }>> => {
          if (options.postFails) return err({ code: "unavailable", message: "down" });
          posted.push(input.body);
          seq += 1;
          return ok({ id: `m-${seq}`, seq, groupId: input.groupId, memberId: input.memberId, kind: "human", body: input.body, replyToMessageId: null, mentionsAgent: mentionsAgent(input.body), planId: null, createdAt: NOW });
        },
      },
      agent: { runs, messages: new FakeMessages(), clock: () => NOW },
    },
  };
  return { deps, posted, runs };
}

describe("runRequestChanges", () => {
  it("posts the request in the person's name and starts Trippy", async () => {
    const { deps, posted } = setup();
    const result = await runRequestChanges(deps, ana, { planId: PLAN, reason: "too_expensive", note: "under 200 please" });

    expect(result.ok && result.value.asked).toBe(true);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatch(/^@trippy I need changes to the plan: it is too expensive for me \(my share is \$/);
    expect(posted[0]).toContain("under 200 please");
  });

  it("still posts when Trippy is too busy to start, and says so", async () => {
    const { deps, posted } = setup();
    await runRequestChanges(deps, ana, { planId: PLAN, reason: "other", note: "" });
    const second = await runRequestChanges(deps, ana, { planId: PLAN, reason: "too_expensive", note: "" });
    expect(second.ok && second.value.asked).toBe(false);
    expect(posted).toHaveLength(2);
  });

  it("works while the plan is waiting for amounts to be approved, but not once the holds are in or the plan is over", async () => {
    expect((await runRequestChanges(setup({ plan: raw("approving") }).deps, ana, { planId: PLAN, reason: "other", note: "" })).ok).toBe(true);
    for (const status of ["held", "booking", "booked", "captured", "expired"] as const) {
      const { deps, posted } = setup({ plan: raw(status) });
      const result = await runRequestChanges(deps, ana, { planId: PLAN, reason: "other", note: "" });
      expect(result.ok, status).toBe(false);
      expect(posted, status).toEqual([]);
    }
  });

  it("refuses someone who is signed out, a plan id that is not an id, and a reason that is not one of the four", async () => {
    const { deps, posted } = setup();
    expect((await runRequestChanges(deps, null, { planId: PLAN, reason: "other", note: "" })).ok).toBe(false);
    expect((await runRequestChanges(deps, ana, { planId: "nope", reason: "other", note: "" })).ok).toBe(false);
    expect((await runRequestChanges(deps, ana, { planId: PLAN, reason: "cancel everything", note: "" })).ok).toBe(false);
    expect(posted).toEqual([]);
  });

  it("answers a plan in someone else's group as it answers a plan that does not exist", async () => {
    const other = await runRequestChanges(setup({ plan: raw("reviewing", "00000000-0000-4000-8000-000000000000") }).deps, ana, { planId: PLAN, reason: "other", note: "" });
    const missing = await runRequestChanges(setup({ plan: "missing" }).deps, ana, { planId: PLAN, reason: "other", note: "" });
    expect(other).toEqual({ ok: false, error: "We couldn't find that plan." });
    expect(missing).toEqual(other);
  });

  it("refuses someone who is in the group but not in the plan", async () => {
    const late: Member = { ...ana, id: "newcomer" };
    const { deps, posted } = setup();
    expect((await runRequestChanges(deps, late, { planId: PLAN, reason: "other", note: "" })).ok).toBe(false);
    expect(posted).toEqual([]);
  });

  it("reports a chat that cannot be reached instead of pretending it was sent", async () => {
    const result = await runRequestChanges(setup({ postFails: true }).deps, ana, { planId: PLAN, reason: "other", note: "" });
    expect(result.ok).toBe(false);
  });
});
