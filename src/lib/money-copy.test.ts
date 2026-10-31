import { describe, expect, it } from "vitest";
import { holdExample, moneyExplainer, MONEY_STEPS } from "./money-copy";

const input = { amountMinor: 6_422, currency: "USD", supportEmail: null, testMode: false, demo: false } as const;

describe("holdExample", () => {
  it("shows a price a little under the approved amount, and what would be released", () => {
    expect(holdExample(6_422, "USD")).toEqual({ finalText: "$59.72", releasedText: "$4.50" });
  });

  it("is left out when the amount is too small to make a clear example", () => {
    expect(holdExample(500, "USD")).toBeNull();
  });
});

describe("moneyExplainer", () => {
  it("puts the person's own amount in the lead, the analogy and the bank view", () => {
    const text = moneyExplainer(input);
    expect(text.lead.join(" ")).toContain("your bank sets aside $64.22 for this trip");
    expect(text.points.find((point) => point.label === "In your banking app")?.text).toContain("pending payment of $64.22");
    expect(text.analogy).toContain("deposit a hotel asks for at check-in");
  });

  it("explains how long a hold lasts, who has the money, and that Unamino adds no fee", () => {
    const text = moneyExplainer(input);
    expect(text.points.map((point) => point.text).join(" ")).toContain("up to about 7 days");
    expect(text.points.find((point) => point.label === "Who has it")?.text).toContain("Unamino never holds your money");
    expect(text.goodToKnow).toContain("Unamino adds no fee");
  });

  it("never calls the hold a charge before the trip is booked", () => {
    const text = moneyExplainer(input);
    expect(text.lead[1]).not.toMatch(/charge/i);
    expect(text.lead[2]).toContain("Only after everyone has approved and every booking is confirmed");
  });

  it("has a one-line summary with the person's amount that does not call the hold a charge", () => {
    const { summary } = moneyExplainer(input);
    expect(summary).toContain("your bank sets aside $64.22");
    expect(summary).toContain("only after everyone has approved");
  });

  it("shows the support line only when there is an address", () => {
    expect(moneyExplainer(input).support).toBeNull();
    expect(moneyExplainer({ ...input, supportEmail: "help@example.com" }).support).toBe("Something wrong with a charge? Email help@example.com.");
  });

  it("says test mode or demo, and nothing for the real thing", () => {
    expect(moneyExplainer(input).modeNote).toBeNull();
    expect(moneyExplainer({ ...input, testMode: true }).modeNote).toBe("Test mode: no real money moves.");
    expect(moneyExplainer({ ...input, demo: true }).modeNote).toContain("Demo");
  });

  it("drops the example for a tiny amount and keeps the rest", () => {
    const text = moneyExplainer({ ...input, amountMinor: 500 });
    expect(text.points.some((point) => point.label === "Example")).toBe(false);
    expect(text.points).toHaveLength(4);
  });
});

describe("MONEY_STEPS", () => {
  it("runs from set aside, to booked, to charged", () => {
    expect(MONEY_STEPS.map((step) => step.when)).toEqual(["Now", "Everyone approved", "Then"]);
  });
});
