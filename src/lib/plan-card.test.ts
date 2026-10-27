import { describe, expect, it } from "vitest";
import { PLAN_STATUSES } from "@/domain/plan/statuses";
import { describePlanCard, type LatestPlan } from "./plan-card";

const latest = (overrides: Partial<LatestPlan> = {}): LatestPlan => ({ id: "plan-2", title: "Bangkok weekend", status: "reviewing", headcount: 4, agreedCount: 1, ...overrides });

describe("describePlanCard", () => {
  it("shows the live plan with how many have agreed", () => {
    expect(describePlanCard("plan-2", latest())).toEqual({ state: "live", title: "Bangkok weekend", detail: "1 of 4 agreed", people: "4 people" });
  });

  it("says person, not people, for a group of one", () => {
    expect(describePlanCard("plan-2", latest({ headcount: 1, agreedCount: 0 })).people).toBe("1 person");
  });

  it("marks an earlier plan as replaced, without showing the newer plan's details under the old card", () => {
    expect(describePlanCard("plan-1", latest())).toEqual({ state: "replaced", title: "Earlier plan", detail: "Replaced by a newer plan", people: null });
  });

  it("copes with there being no plan at all", () => {
    expect(describePlanCard("plan-1", null)).toMatchObject({ state: "gone" });
  });

  it("has something to say for every state a plan can be in", () => {
    for (const status of PLAN_STATUSES) {
      const view = describePlanCard("plan-2", latest({ status }));
      expect(view.detail.length, status).toBeGreaterThan(3);
    }
  });
});
