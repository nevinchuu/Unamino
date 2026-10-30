import { describe, expect, it } from "vitest";
import { PLAN_STATUSES } from "@/domain/plan/statuses";
import { describePlanCard, describeSheet, type CardMine, type CardPerson, type CardPlan } from "./plan-card";

const plan = (overrides: Partial<CardPlan> = {}): CardPlan => ({ id: "plan-2", title: "Bangkok weekend", status: "reviewing", headcount: 4, agreedCount: 1, replacedById: null, ...overrides });

describe("describePlanCard", () => {
  it("shows the live plan with how many have agreed", () => {
    expect(describePlanCard("plan-2", [plan()])).toEqual({ state: "live", title: "Bangkok weekend", detail: "1 of 4 agreed", people: "4 people", opens: "plan-2" });
  });

  it("says person, not people, for a group of one", () => {
    expect(describePlanCard("plan-2", [plan({ headcount: 1, agreedCount: 0 })]).people).toBe("1 person");
  });

  it("marks a plan that a newer one took over from as replaced, and points to the newer plan", () => {
    const old = plan({ id: "plan-1", status: "expired", replacedById: "plan-2" });
    expect(describePlanCard("plan-1", [old, plan()])).toEqual({ state: "replaced", title: "Earlier plan", detail: "Replaced by a newer plan", people: null, opens: "plan-2" });
  });

  it("keeps a paid trip as paid when the group has moved on to another trip", () => {
    const paid = plan({ id: "plan-1", status: "captured", title: "December weekend", headcount: 2, agreedCount: 2 });
    expect(describePlanCard("plan-1", [paid, plan({ id: "plan-2" })])).toEqual({ state: "live", title: "December weekend", detail: "Booked and paid", people: "2 people", opens: "plan-1" });
  });

  it("says an ended plan ended, not replaced, when nothing replaced it", () => {
    const ended = plan({ id: "plan-1", status: "expired" });
    expect(describePlanCard("plan-1", [ended, plan({ id: "plan-2" })])).toMatchObject({ state: "live", detail: "This plan ended", opens: "plan-1" });
  });

  it("copes with there being no such plan", () => {
    expect(describePlanCard("plan-1", [])).toMatchObject({ state: "gone", opens: null });
  });

  it("has something to say for every state a plan can be in", () => {
    for (const status of PLAN_STATUSES) {
      const view = describePlanCard("plan-2", [plan({ status })]);
      expect(view.detail.length, status).toBeGreaterThan(3);
    }
  });
});

const person = (name: string, overrides: Partial<CardPerson> = {}): CardPerson => ({ name, isMe: false, agreed: false, approved: false, held: false, ...overrides });
const mineWith = (people: readonly CardPerson[], overrides: Partial<CardMine> = {}): CardMine => ({ canAgree: true, agreed: false, canRequestChanges: true, canCover: true, shareMinor: 6434, currency: "USD", lines: [], people, needsAmount: false, detail: { subtitle: "", items: [], ideas: [], totalMinor: null, currency: "USD" }, ...overrides });

describe("describeSheet", () => {
  const people = [person("Nev", { isMe: true }), person("Ana", { agreed: true }), person("Ben"), person("Jia", { agreed: true })];

  it("counts who agreed, and says who the plan is waiting for, naming the viewer as you", () => {
    expect(describeSheet(plan({ headcount: 4 }), mineWith(people))).toEqual({ step: "agree", stepNumber: 1, pill: "2/4 agreed", note: "Ana and Jia agreed. Waiting for you and Ben.", actionable: true });
  });

  it("has nothing for the viewer to do once they have agreed", () => {
    const agreed = people.map((p) => (p.isMe ? { ...p, agreed: true } : p));
    expect(describeSheet(plan({ headcount: 4 }), mineWith(agreed, { canAgree: false, agreed: true }))).toMatchObject({ pill: "3/4 agreed", note: "Ana and Jia agreed. Waiting for Ben.", actionable: false });
  });

  it("moves to approving the amount, counting holds instead of agreements", () => {
    const holding = [person("Nev", { isMe: true, agreed: true }), person("Ana", { agreed: true, approved: true, held: true }), person("Ben", { agreed: true, approved: true })];
    expect(describeSheet(plan({ status: "approving", headcount: 3 }), mineWith(holding, { canAgree: false, agreed: true, needsAmount: true }))).toEqual({ step: "approve", stepNumber: 2, pill: "1/3 held", note: "Ana held. Waiting for you and Ben.", actionable: true });
  });

  it("says nothing about waiting when everyone is done", () => {
    const all = [person("Nev", { isMe: true, agreed: true }), person("Ana", { agreed: true })];
    expect(describeSheet(plan({ headcount: 2 }), mineWith(all, { canAgree: false, agreed: true })).note).toBe("Ana agreed.");
  });

  it("copes with a plan whose people are not known", () => {
    expect(describeSheet(plan({ headcount: 4 }), mineWith([]))).toMatchObject({ pill: "0/4 agreed", note: "" });
  });
});
