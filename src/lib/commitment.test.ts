import { describe, expect, it } from "vitest";
import { PLAN_STATUSES } from "@/domain/plan/statuses";
import { commitmentLabel, commitmentOf, commitmentStepOf, isCommitted } from "./commitment";

describe("commitmentOf", () => {
  it("turns green on agreeing while the plan is being agreed to", () => {
    expect(commitmentOf("agree", { agreed: true, held: false })).toBe("agreed");
    expect(commitmentOf("agree", { agreed: false, held: false })).toBe("not_yet");
  });

  it("starts again once approving begins: agreeing no longer counts, only a placed hold does", () => {
    expect(commitmentOf("approve", { agreed: true, held: false })).toBe("not_yet");
    expect(commitmentOf("approve", { agreed: true, held: true })).toBe("approved");
  });
});

describe("commitmentStepOf", () => {
  it("asks for agreement only while the plan is a draft or being reviewed", () => {
    const agreeing = PLAN_STATUSES.filter((status) => commitmentStepOf(status) === "agree");
    expect(agreeing).toEqual(["draft", "reviewing"]);
  });
});

describe("commitmentLabel", () => {
  it("uses one word for each state, and only the done states are green", () => {
    expect(commitmentLabel("not_yet")).toBe("Not yet");
    expect(commitmentLabel("agreed")).toBe("Agreed");
    expect(commitmentLabel("approved")).toBe("Approved");
    expect([isCommitted("not_yet"), isCommitted("agreed"), isCommitted("approved")]).toEqual([false, true, true]);
  });
});
