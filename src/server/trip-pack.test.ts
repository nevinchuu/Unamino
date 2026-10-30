import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import type { Member } from "@/domain/group/types";
import type { PlanStatus } from "@/domain/plan/statuses";
import { flight, hotel } from "@/domain/plan/test-support";
import type { PlanViewRaw } from "@/domain/plan/view-store";
import type { PlanViewDeps } from "./plan-view";
import { handleCalendar } from "./trip-pack";

const PLAN_ID = "3f2b8c1e-5a4d-4e0b-9c7a-1d2e3f4a5b6c";
const GROUP = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const NOW = new Date("2026-12-01T09:00:00Z");
const ana: Member = { id: "ana", groupId: GROUP, displayName: "Ana", currency: "USD", isOrganiser: false };

const raw = (status: PlanStatus, trip: PlanViewRaw["trip"] = { city: "Bangkok", departDate: "2026-12-15", returnDate: "2026-12-18" }): PlanViewRaw => ({
  id: PLAN_ID, groupId: GROUP, title: "Bangkok weekend", summary: null, status, deadlineAt: new Date("2026-10-27T01:09:00Z"), baseCurrency: "USD",
  fx: { baseCurrency: "USD", source: "test", ratesPerBase: {} }, headcount: 1, replacedByPlanId: null, trip,
  members: [{ id: "ana", name: "Ana", currency: "USD", planAgreement: "agreed", approval: "approved", approvedMinor: 100, chargedMinor: 100, holdPlaced: true }],
  picks: [{ id: "p1", offer: hotel(), memberIds: ["ana"], reason: "r", notes: {} }, { id: "p2", offer: flight(), memberIds: ["ana"], reason: "r", notes: {} }], ideas: [], covers: [], bookings: [],
});

function deps(plan: PlanViewRaw | "missing" | "down", member: Member | null = ana): PlanViewDeps {
  return {
    views: { load: async () => (plan === "missing" ? err({ code: "not_found" as const, message: "none" }) : plan === "down" ? err({ code: "unavailable" as const, message: "db" }) : ok(plan)) },
    memberOf: async () => member,
    payments: "none",
    scheduleRefresh: () => undefined,
  };
}

describe("handleCalendar", () => {
  it("gives a member of the group the trip's calendar file for a booked trip", async () => {
    const response = await handleCalendar(deps(raw("captured")), GROUP, PLAN_ID, NOW);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="unamino-UN-3F2B8C.ics"');
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("DTSTART;VALUE=DATE:20261215");
  });

  it("also works for a trip that is booked and about to be charged", async () => {
    expect((await handleCalendar(deps(raw("booked")), GROUP, PLAN_ID, NOW)).status).toBe(200);
  });

  it.each<PlanStatus>(["draft", "reviewing", "approving", "held", "booking", "expired"])("answers not found while the trip is %s", async (status) => {
    expect((await handleCalendar(deps(raw(status)), GROUP, PLAN_ID, NOW)).status).toBe(404);
  });

  it("answers not found to someone outside the group, to a plan in another group, and to a plan that does not exist", async () => {
    expect((await handleCalendar(deps(raw("captured"), null), GROUP, PLAN_ID, NOW)).status).toBe(404);
    expect((await handleCalendar(deps(raw("captured")), "another-group", PLAN_ID, NOW)).status).toBe(404);
    expect((await handleCalendar(deps("missing"), GROUP, PLAN_ID, NOW)).status).toBe(404);
    expect((await handleCalendar(deps(raw("captured")), GROUP, "not-an-id", NOW)).status).toBe(404);
  });

  it("answers not found for a trip with no dates, because there is nowhere to put it", async () => {
    expect((await handleCalendar(deps(raw("captured", { city: "Bangkok", departDate: null, returnDate: null })), GROUP, PLAN_ID, NOW)).status).toBe(404);
  });

  it("says it is unavailable, and not missing, when the database is down", async () => {
    expect((await handleCalendar(deps("down"), GROUP, PLAN_ID, NOW)).status).toBe(503);
  });
});
