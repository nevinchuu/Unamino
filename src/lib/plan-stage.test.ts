import { describe, expect, it } from "vitest";
import type { ApprovalStatus, PlanAgreementStatus, PlanStatus } from "@/domain/plan/statuses";
import type { PersonDto, PlanViewDto } from "@/domain/plan/view";
import { clockText, countdownText, describeStage, isUrgent, priceHoldElapsed } from "./plan-stage";

const person = (id: string, agreement: PlanAgreementStatus = "pending", approval: ApprovalStatus = "pending"): PersonDto => ({ id, name: id, isMe: id === "ana", agreement, approval, holdPlaced: false, shareMinor: 30_000, currency: "USD", approvedMinor: null, chargedMinor: null, lines: [], ownPartMinor: 30_000, previousShareMinor: null, coveredByMe: null });

function view(status: PlanStatus, people: PersonDto[], overrides: Partial<PlanViewDto> = {}, inPlan = true): PlanViewDto {
  const mine = people.find((p) => p.isMe);
  return {
    id: "p", groupId: "g", title: "t", summary: null, status, city: null, dates: null, tripDates: { departDate: null, returnDate: null }, keptUntil: null, headcount: people.length, deadlineAt: "2026-10-27T01:09:00.000Z", replacedBy: null, reference: null, payments: "none", demoBooking: false, currency: "USD", pricesAvailable: true, refundWarning: null, items: [], ideas: [], confirmations: [], progress: [], failure: null, people, covers: [],
    me: { id: "ana", inPlan, agreement: mine?.agreement ?? null, approval: mine?.approval ?? null, shareMinor: 30_000, approvedMinor: null, cardNeeded: false, awaitingDetails: false, details: { needed: false, passportRequired: false }, actions: { agree: false, decline: false, approve: false, declineAmount: false, requestChanges: false, cover: false } },
    ...overrides,
  };
}

describe("describeStage once the trip is booked", () => {
  const owing = (id: string, chargedMinor: number | null, approvedMinor: number | null = 30_000): PersonDto => ({ ...person(id, "agreed", "approved"), approvedMinor, chargedMinor });

  it("says the cards are being charged before any has been", () => {
    expect(describeStage(view("booked", [owing("ana", null), owing("ben", null)])).detail).toBe("Everything is booked. The cards are being charged.");
  });

  it("says how many cards have been charged when only some have, and that the rest are tried again", () => {
    const stage = describeStage(view("booked", [owing("ana", 30_000), owing("ben", 30_000), owing("jia", null), owing("kai", null)]));
    expect(stage).toMatchObject({ headline: "Booked", tone: "good" });
    expect(stage.detail).toBe("The trip is booked. 2 of 4 cards have been charged and we are trying the rest again. Nobody is charged more than they approved.");
  });

  it("says has, not have, for one card", () => {
    expect(describeStage(view("booked", [owing("ana", 30_000), owing("ben", null), owing("jia", null)])).detail).toContain("1 of 3 cards has been charged");
  });

  it("does not wait for someone a friend covers in full, who has no card to charge", () => {
    const stage = describeStage(view("booked", [owing("ana", 30_000), owing("ben", null), owing("jia", null, 0)]));
    expect(stage.detail).toContain("1 of 2 cards has been charged");
  });

  it("says everyone has been charged once the plan is paid", () => {
    expect(describeStage(view("captured", [owing("ana", 30_000), owing("ben", 30_000)])).headline).toBe("Booked and paid");
  });
});

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
    expect(stage.detail).toBe("2 of 3 have approved. Nothing is charged until everyone has approved.");
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

  it("says everyone has approved once every hold is placed", () => {
    expect(describeStage(view("held", [person("ana", "agreed", "approved")]))).toMatchObject({ headline: "Everyone has approved", tone: "good", step: null });
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

describe("describeStage for a plan whose booking failed", () => {
  it("says booking did not go through, and that nobody was charged, instead of the plain 'plan ended'", () => {
    const failure = { summary: "The hotel Baiyoke could not be booked because it is no longer available.", undone: null, retryable: false };
    const stage = describeStage(view("expired", [person("ana"), person("ben")], { failure }));
    expect(stage).toMatchObject({ headline: "Booking didn't go through", tone: "ended" });
    expect(stage.detail).toContain("Nothing was charged");
  });
});

describe("clockText", () => {
  const deadline = new Date("2026-10-27T01:10:00Z");
  const at = (iso: string) => clockText(deadline, new Date(iso));

  it("shows minutes and seconds, and hours only when there are some", () => {
    expect(at("2026-10-27T01:00:19Z")).toBe("9:41");
    expect(at("2026-10-27T01:09:55Z")).toBe("0:05");
    expect(at("2026-10-26T23:04:59Z")).toBe("2:05:01");
  });

  it("rounds up and never goes below zero", () => {
    expect(at("2026-10-27T01:09:59.500Z")).toBe("0:01");
    expect(at("2026-10-27T05:00:00Z")).toBe("0:00");
  });
});

describe("isUrgent", () => {
  const deadline = new Date("2026-10-27T01:10:00Z");

  it("turns urgent in the last two minutes, and not once the time has run out", () => {
    expect(isUrgent(deadline, new Date("2026-10-27T01:07:59Z"))).toBe(false);
    expect(isUrgent(deadline, new Date("2026-10-27T01:08:00Z"))).toBe(true);
    expect(isUrgent(deadline, deadline)).toBe(false);
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
