import { describe, expect, it } from "vitest";
import { planReference } from "./plan-reference";

describe("planReference", () => {
  it("makes a short code from the start of the plan id", () => {
    expect(planReference("e79dbeb9-8c15-4039-8145-bb78a0b3c842")).toBe("UN-E79DBE");
  });

  it("gives the same code for the same plan, and different codes for different plans", () => {
    const a = "33151d13-86ec-4f57-8cce-b0e375df83b3";
    expect(planReference(a)).toBe(planReference(a));
    expect(planReference(a)).not.toBe(planReference("e00c9615-9df0-4cc9-8254-94d67f620dd1"));
  });

  it("still gives a code of the same length for an odd id", () => {
    expect(planReference("zz")).toBe("UN-000000");
    expect(planReference("plan-1")).toHaveLength(9);
  });
});
