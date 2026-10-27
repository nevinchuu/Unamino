import { describe, expect, it } from "vitest";
import type { ApprovalStatus, PlanAgreementStatus, PlanStatus } from "@/domain/plan/statuses";
import type { PersonDto, PlanViewDto } from "@/domain/plan/view";
import { countdownText, describeStage, priceHoldElapsed } from "./plan-stage";

const person = (id: string, agreement: PlanAgreementStatus = "pending", approval: ApprovalStatus = "pending"): PersonDto => ({ id, name: id, isMe: id === "ana", agreement, approval, holdPlaced: false, shareMinor: 30_000, currency: "USD", approvedMinor: null, lines: [] });

function view(status: PlanStatus, people: PersonDto[], overrides: Partial<PlanViewDto> = {}, inPlan = true): PlanViewDto {
  const mine = people.find((p) => p.isMe);
  return {
    id: "p", groupId: "g", title: "t", summary: null, status, city: null, dates: null, headcount: people.length, deadlineAt: "2026-10-27T01:09:00.000Z", replacedBy: null, payments: "none", demoBooking: false, currency: "USD", pricesAvailable: true, items: [], ideas: [], people,
    me: { id: "ana", inPlan, agreement: mine?.agreement ?? null, approval: mine?.approval ?? null, shareMinor: 30_000, approvedMinor: null, cardNeeded: false, details: { needed: false, passportRequired: false }, actions: { agree: false, decline: false, approve: false, declineAmount: false } },
    ...overrides,
  };
}

describe("describeStage", () => {
  it("asks a person who has not agreed to look over the plan, and says nothing is charged yet", () => {
    const stage = describeStage(view("reviewing", [person("ana"), person("ben", "agreed"), person("jia")]));
    expect(stage).toMatchObject({ step: "Step 1 of 2", headline: "Look over the plan", tone: "action" });
    expect(stage.detail).toBe("1 of 3 have agreed. Nothing is charged at this step.");
  });

  it("tells someone who agreed how many they are waiting for", () => {
    const stage = describeStage(view("reviewing", [person("ana", "agreed"), person("ben", "agreed"), person("jia")]));
    expect(stage).toMatchObject({ headline: "You agreed", tone: "waiting", detail: "2 of 3 have agreed. Waiting for 1 more." });
  });

  it("asks each person to approve their amount in step 2, with the cap rule in plain words", () => {
    const stage = describeStage(view("approving", [person("ana", "agreed"), person("ben", "agreed", "approved")]));
    expect(stage).toMatchObject({ step: "Step 2 of 2", headline: "Approve your amount", tone: "action" });
    expect(stage.detail).toMatch(/most you'll be charged/);
  });

  it("tells someone who approved how many have, and that nothing is charged yet", () => {
    const stage = describeStage(view("approving", [person("ana", "agreed", "approved"), person("ben", "agreed", "approved"), person("jia", "agreed")]));
    expect(stage).toMatchObject({ headline: "You've approved", tone: "waiting" });
    expect(stage.detail).toBe("2 of 3 have approved. Nothing is charged until everyone is in.");
  });

  it("asks someone who approved to add their card, until it is on the hold", () => {
    const base = view("approving", [person("ana", "agreed", "approved"), person("ben", "agreed")]);
    const needsCard = { ...base, me: { ...base.me, cardNeeded: true } };
    expect(describeStage(needsCard)).toMatchObject({ step: "Step 2 of 2", headline: "Add your card", tone: "action" });
    expect(describeStage(base)).toMatchObject({ headline: "You've approved", tone: "waiting" });
  });

  it("tells a person whose price rose past their cap, and only them", () => {
    const stage = describeStage(view("approving", [person("ana", "agreed", "needs_reapproval"), person("ben", "agreed", "approved")]));
    expect(stage).toMatchObject({ headline: "Your price went up", tone: "action" });
  });

  it("says everyone is in once every hold is placed", () => {
    expect(describeStage(view("held", [person("ana", "agreed", "approved")]))).toMatchObject({ headline: "Everyone's in", tone: "good", step: null });
  });

  it("describes the booking states", () => {
    expect(describeStage(view("booking", [person("ana")])).headline).toBe("Booking now");
    expect(describeStage(view("booked", [person("ana")])).headline).toBe("Booked");
    expect(describeStage(view("captured", [person("ana")])).headline).toBe("Booked and paid");
  });

  it("says a plan ended, and points to a newer plan when there is one, or to the agent when there is not", () => {
    expect(describeStage(view("expired", [person("ana")]))).toMatchObject({ headline: "This plan ended", tone: "ended", detail: "Mention @trippy in the chat to start a new one." });
    expect(describeStage(view("expired", [person("ana")], { replacedBy: "plan-2" })).detail).toBe("A newer plan took its place.");
  });

  it("explains to someone who joined later that the plan does not include them", () => {
    const stage = describeStage(view("reviewing", [person("ben")], {}, false));
    expect(stage).toMatchObject({ headline: "You joined after this plan was made", tone: "waiting" });
  });
});

describe("countdownText", () => {
  const deadline = new Date("2026-10-27T01:10:00Z");
  const at = (iso: string) => countdownText(deadline, new Date(iso));

  it("counts seconds under a minute, minutes under an hour, then hours", () => {
    expect(at("2026-10-27T01:09:15Z")).toBe("45 sec left");
    expect(at("2026-10-27T01:02:00Z")).toBe("8 min left");
    expect(at("2026-10-26T23:40:00Z")).toBe("1 hr 30 min left");
    expect(at("2026-10-26T23:10:00Z")).toBe("2 hr left");
  });

  it("rounds up, so the last moments never read as zero", () => {
    expect(at("2026-10-27T01:09:59.500Z")).toBe("1 sec left");
    expect(at("2026-10-27T01:08:59.500Z")).toBe("2 min left");
  });

  it("knows when the held prices have run out, at the deadline and after it", () => {
    const deadline = new Date("2026-10-27T01:10:00Z");
    expect(priceHoldElapsed(deadline, new Date("2026-10-27T01:09:59Z"))).toBe(false);
    expect(priceHoldElapsed(deadline, deadline)).toBe(true);
    expect(priceHoldElapsed(deadline, new Date("2026-10-27T05:00:00Z"))).toBe(true);
  });

  it("says time is up at the deadline and after it", () => {
    expect(at("2026-10-27T01:10:00Z")).toBe("Time's up");
    expect(at("2026-10-27T05:00:00Z")).toBe("Time's up");
  });
});
