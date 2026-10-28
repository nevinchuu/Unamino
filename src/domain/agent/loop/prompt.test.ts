import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "./prompt";

describe("SYSTEM_PROMPT", () => {
  it("tells Trippy that a request for changes adjusts the current plan instead of ending it", () => {
    expect(SYSTEM_PROMPT).toContain("I need changes to the plan");
    expect(SYSTEM_PROMPT).toContain("not ended");
  });

  it("holds no backtick, because it is a template literal", () => {
    expect(SYSTEM_PROMPT).not.toContain("`");
  });
});
