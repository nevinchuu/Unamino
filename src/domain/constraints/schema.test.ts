import { describe, expect, it } from "vitest";
import { constraintSetSchema, memberConstraintsSchema } from "./schema";

describe("memberConstraintsSchema", () => {
  it("accepts the wireframe's constraints", () => {
    expect(memberConstraintsSchema.safeParse({ outboundDeparture: { after: "18:00" } }).success).toBe(true);
    expect(memberConstraintsSchema.safeParse({ budgetCap: { amountMinor: 35000, currency: "USD" } }).success).toBe(true);
    expect(memberConstraintsSchema.safeParse({ ownRoom: true, skipActivityCategories: ["cooking"] }).success).toBe(true);
  });

  it("treats an empty object as no restriction", () => {
    expect(memberConstraintsSchema.safeParse({}).success).toBe(true);
  });

  it("rejects bad times, windows and caps", () => {
    expect(memberConstraintsSchema.safeParse({ outboundDeparture: { after: "6pm" } }).success).toBe(false);
    expect(memberConstraintsSchema.safeParse({ outboundDeparture: { after: "24:00" } }).success).toBe(false);
    expect(memberConstraintsSchema.safeParse({ outboundDeparture: {} }).success).toBe(false);
    expect(memberConstraintsSchema.safeParse({ budgetCap: { amountMinor: 0, currency: "USD" } }).success).toBe(false);
    expect(memberConstraintsSchema.safeParse({ budgetCap: { amountMinor: 350.5, currency: "USD" } }).success).toBe(false);
    expect(memberConstraintsSchema.safeParse({ budgetCap: { amountMinor: 100, currency: "usd" } }).success).toBe(false);
  });

  it("normalises skipped activity categories to lowercase", () => {
    const result = memberConstraintsSchema.parse({ skipActivityCategories: [" Cooking "] });
    expect(result.skipActivityCategories).toEqual(["cooking"]);
  });
});

describe("constraintSetSchema", () => {
  it("keys constraints by member id and allows silent members to be absent", () => {
    const result = constraintSetSchema.safeParse({
      ana: { outboundDeparture: { after: "18:00" } },
      ben: { budgetCap: { amountMinor: 35000, currency: "USD" } },
    });
    expect(result.success).toBe(true);
  });
});
