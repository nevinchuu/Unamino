import { describe, expect, it } from "vitest";
import { REMINDER_COOLDOWN_MS, REMINDER_MARKER, reminderLine } from "./reminder";

describe("reminderLine", () => {
  it("nudges the people who have not agreed", () => {
    expect(reminderLine("Ana", "agree", ["Ben"])).toBe("Ana is waiting for Ben to agree to the plan.");
    expect(reminderLine("Ana", "agree", ["Ben", "Cai"])).toBe("Ana is waiting for Ben and Cai to agree to the plan.");
    expect(reminderLine("Ana", "agree", ["Ben", "Cai", "Dee"])).toBe("Ana is waiting for Ben, Cai and Dee to agree to the plan.");
  });

  it("nudges the people who have not approved their amount and added a card", () => {
    expect(reminderLine("Ana", "approve", ["Ben"])).toBe("Ana is waiting for Ben to approve their amount and add a card.");
  });

  it("says nothing when nobody is waited for", () => {
    expect(reminderLine("Ana", "agree", [])).toBeNull();
  });

  it("carries the marker the throttle looks for, and the cooldown is minutes, not seconds", () => {
    expect(reminderLine("Ana", "agree", ["Ben"])).toContain(REMINDER_MARKER);
    expect(REMINDER_COOLDOWN_MS).toBe(300_000);
  });
});
