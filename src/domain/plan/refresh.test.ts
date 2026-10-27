import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import { refreshPlan, REFRESH_COOLDOWN_MS } from "./refresh";
import type { PlanStatus } from "./statuses";
import { agreed, approved, DEADLINE, FLIGHT_QUERY, flight, HOTEL_QUERY, hotel, memberSnapshot, minutesAfter, NOW, ScriptedSource, setup } from "./test-support";

async function refresh(setupResult: ReturnType<typeof setup>) {
  const result = await refreshPlan(setupResult.deps, "plan-1", NOW);
  if (!result.ok) throw new Error(`refresh failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

describe("refreshPlan", () => {
  describe("when nothing needs checking", () => {
    it.each<PlanStatus>(["draft", "booking", "booked", "captured", "expired"])("does not look at a plan that is %s", async (status) => {
      const s = setup({ status });
      expect(await refresh(s)).toEqual({ status: "skipped", reason: "not_open" });
      expect(s.source.queries).toHaveLength(0);
      expect(s.details.claims).toBe(0);
    });

    it("does not search again inside the cooldown", async () => {
      const s = setup({ offersCheckedAt: new Date(NOW.getTime() - (REFRESH_COOLDOWN_MS - 1)) });
      expect(await refresh(s)).toEqual({ status: "skipped", reason: "cooldown" });
      expect(s.source.queries).toHaveLength(0);
    });

    it("searches again once the cooldown has passed", async () => {
      const s = setup({ offersCheckedAt: new Date(NOW.getTime() - REFRESH_COOLDOWN_MS) });
      expect((await refresh(s)).status).toBe("refreshed");
    });
  });

  describe("when every listing is still on sale", () => {
    it("runs each stored search once and keeps the renewed offers", async () => {
      const s = setup();
      await refresh(s);
      expect(s.source.queries).toEqual(expect.arrayContaining([HOTEL_QUERY, FLIGHT_QUERY]));
      expect(s.source.queries).toHaveLength(2);
      expect(s.details.details.picks.map((pick) => pick.offer.id)).toEqual(["hotel-offer-2", "flight-offer-2"]);
    });

    it("searches once for picks that came from the same search", async () => {
      const s = setup();
      s.details.details = { ...s.details.details, picks: s.details.details.picks.map((pick) => ({ ...pick, searchId: "search-hotel" })) };
      s.world.hotels = [hotel({ id: "h2", expiresAt: minutesAfter(9).toISOString() }), flight({ id: "f2", expiresAt: minutesAfter(9).toISOString() })];
      await refresh(s);
      expect(s.source.queries).toEqual([HOTEL_QUERY]);
    });

    it("moves the deadline to the earliest new expiry", async () => {
      const s = setup({ world: { hotels: [hotel({ id: "h2", expiresAt: minutesAfter(9).toISOString() })], flights: [flight({ id: "f2", expiresAt: minutesAfter(12).toISOString() })] } });
      const outcome = await refresh(s);
      expect(outcome).toMatchObject({ status: "refreshed", deadlineExtended: true });
      expect(s.plans.plan.deadlineAt).toEqual(minutesAfter(9));
    });

    it("never moves the deadline past the hard cap", async () => {
      const s = setup({ hardDeadlineAt: minutesAfter(5) });
      await refresh(s);
      expect(s.plans.plan.deadlineAt).toEqual(minutesAfter(5));
    });

    it("leaves the deadline alone when the offers do not last longer", async () => {
      const s = setup({ world: { hotels: [hotel({ id: "h2", expiresAt: DEADLINE.toISOString() })], flights: [flight({ id: "f2", expiresAt: DEADLINE.toISOString() })] } });
      expect(await refresh(s)).toMatchObject({ status: "refreshed", deadlineExtended: false });
      expect(s.plans.plan.deadlineAt).toEqual(DEADLINE);
    });

    it("moves approvals with the deadline", async () => {
      const s = setup({ status: "held", members: [approved("ana", { holdPlaced: true }), approved("ben", { holdPlaced: true })] });
      await refresh(s);
      expect(s.plans.plan.members.map((member) => member.approvalExpiresAt)).toEqual([minutesAfter(9), minutesAfter(9)]);
    });

    it("returns each member's price in their own currency", async () => {
      const s = setup();
      const outcome = await refresh(s);
      if (outcome.status !== "refreshed") throw new Error("expected a refresh");
      expect(outcome.shares.map((share) => [share.memberId, share.shareMinor])).toEqual([["ana", 30_000], ["ben", 30_000]]);
    });

    it("takes the cheapest when a listing comes back more than once", async () => {
      const s = setup({ world: { hotels: [hotel({ id: "dear", totalMinor: 60_000, expiresAt: minutesAfter(9).toISOString() }), hotel({ id: "cheap", totalMinor: 30_000, expiresAt: minutesAfter(9).toISOString() })] } });
      await refresh(s);
      expect(s.details.details.picks[0].offer.id).toBe("cheap");
    });
  });

  describe("while the group is reviewing", () => {
    it("shows a small rise as a note and keeps everyone's agreement", async () => {
      const s = setup({ members: [agreed("ana"), agreed("ben")], world: { hotels: [hotel({ id: "h2", totalMinor: 41_000, expiresAt: minutesAfter(9).toISOString() })] } });
      const outcome = await refresh(s);
      expect(outcome).toMatchObject({ status: "refreshed", effects: [] });
      expect(s.plans.plan.members.map((member) => member.planAgreement)).toEqual(["agreed", "agreed"]);
    });

    it("sends everyone back to look again when the price rises by more than 5%", async () => {
      const s = setup({ members: [agreed("ana"), agreed("ben")], world: { hotels: [hotel({ id: "h2", totalMinor: 50_000, expiresAt: minutesAfter(9).toISOString() })] } });
      const outcome = await refresh(s);
      expect(outcome).toMatchObject({ status: "refreshed", effects: [{ type: "request_review", memberIds: ["ana", "ben"] }] });
      expect(s.plans.plan.status).toBe("reviewing");
      expect(s.plans.plan.members.map((member) => member.planAgreement)).toEqual(["pending", "pending"]);
    });
  });

  describe("while members approve their amounts", () => {
    it("only sends back the member whose price went past their cap", async () => {
      const s = setup({ status: "approving", members: [approved("ana"), memberSnapshot("ben", { planAgreement: "agreed", agreedShareMinor: 30_000 })], world: { hotels: [hotel({ id: "h2", totalMinor: 50_000, expiresAt: minutesAfter(9).toISOString() })] } });
      const outcome = await refresh(s);
      expect(outcome).toMatchObject({ status: "refreshed", effects: [{ type: "release_holds", memberIds: ["ana"] }, { type: "request_reapproval", memberId: "ana", newAmountMinor: 35_000 }] });
      expect(s.plans.plan.members.map((member) => member.approval)).toEqual(["needs_reapproval", "pending"]);
    });

    it("does not touch members who have not approved yet", async () => {
      const s = setup({ status: "approving", members: [memberSnapshot("ana", { planAgreement: "agreed", agreedShareMinor: 30_000 }), memberSnapshot("ben", { planAgreement: "agreed", agreedShareMinor: 30_000 })] });
      expect((await refresh(s)).status).toBe("refreshed");
      expect(s.plans.plan.members.map((member) => member.currentShareMinor)).toEqual([null, null]);
    });

    it("charges less when the price falls, and keeps the approval", async () => {
      const s = setup({ status: "approving", members: [approved("ana"), approved("ben")], world: { hotels: [hotel({ id: "h2", totalMinor: 30_000, expiresAt: minutesAfter(9).toISOString() })] } });
      await refresh(s);
      expect(s.plans.plan.members.map((member) => [member.approval, member.approvedMinor, member.currentShareMinor])).toEqual([["approved", 30_000, 25_000], ["approved", 30_000, 25_000]]);
    });

    it("sends only the affected member back once every hold is placed", async () => {
      const s = setup({ status: "held", members: [approved("ana", { holdPlaced: true }), approved("ben", { holdPlaced: true })], world: { hotels: [hotel({ id: "h2", totalMinor: 50_000, expiresAt: minutesAfter(9).toISOString() })] } });
      const outcome = await refresh(s);
      expect(outcome).toMatchObject({ status: "refreshed" });
      expect(s.plans.plan.status).toBe("approving");
    });
  });

  describe("when a listing is gone", () => {
    it("ends the plan and names what could not be found", async () => {
      const s = setup({ world: { hotels: [hotel({ id: "other", listingId: "another-room" })] } });
      const outcome = await refresh(s);
      expect(outcome).toMatchObject({ status: "unavailable", titles: ["Riverside Hotel"] });
      expect(s.plans.plan.status).toBe("expired");
      expect(s.details.renewals).toHaveLength(0);
    });

    it("gives holds back when the plan ends", async () => {
      const s = setup({ status: "held", members: [approved("ana", { holdPlaced: true }), approved("ben", { holdPlaced: true })], world: { flights: [] } });
      const outcome = await refresh(s);
      expect(outcome).toMatchObject({ status: "unavailable", effects: [{ type: "release_holds", memberIds: ["ana", "ben"] }] });
    });

    it("treats a listing priced for a different party size as gone", async () => {
      const s = setup({ world: { hotels: [hotel({ id: "h2", guests: 3 })] } });
      expect((await refresh(s)).status).toBe("unavailable");
    });

    it("treats a pick whose search no longer exists as gone", async () => {
      const s = setup({ hotelSearchId: null });
      expect(await refresh(s)).toMatchObject({ status: "unavailable", titles: ["Riverside Hotel"] });
    });
  });

  describe("when the check cannot be completed", () => {
    it("leaves the plan unchanged if a search fails, and says so", async () => {
      const s = setup({ members: [agreed("ana"), agreed("ben")] });
      const before = s.plans.stored;
      const failing = new ScriptedSource((query) => (query.kind === "hotel" ? err({ code: "source_unavailable", message: "timeout" }) : ok([flight({ id: "f2" })])));
      const result = await refreshPlan({ ...s.deps, source: failing }, "plan-1", NOW);
      expect(result).toEqual({ ok: false, error: { kind: "search_failed", message: "timeout" } });
      expect(s.plans.stored).toBe(before);
      expect(s.details.renewals).toHaveLength(0);
    });

    it("tries a failed search once more before giving up", async () => {
      const s = setup();
      let calls = 0;
      const flaky = new ScriptedSource((query) => {
        if (query.kind === "hotel") {
          calls += 1;
          return calls === 1 ? err({ code: "source_unavailable", message: "busy" }) : ok([hotel({ id: "h2", expiresAt: minutesAfter(9).toISOString() })]);
        }
        return ok([flight({ id: "f2", expiresAt: minutesAfter(9).toISOString() })]);
      });
      const result = await refreshPlan({ ...s.deps, source: flaky }, "plan-1", NOW);
      expect(result.ok && result.value.status).toBe("refreshed");
    });

    it("does not save offers that cannot be priced in the plan's currency", async () => {
      const s = setup({ world: { hotels: [hotel({ id: "h2", currency: "SGD" })] } });
      const before = s.plans.stored;
      const result = await refreshPlan(s.deps, "plan-1", NOW);
      expect(result.ok ? null : result.error.kind).toBe("pricing_failed");
      expect(s.plans.stored).toBe(before);
      expect(s.details.renewals).toHaveLength(0);
    });
  });
});
