import { describe, expect, it } from "vitest";
import { fallbackNudge, REMINDER_COOLDOWN_MS, REMINDER_MARKER, reminderLine } from "./reminder";

describe("reminderLine", () => {
  it("says who asked for the nudge and who it is for", () => {
    expect(reminderLine("Ana", ["Ben"])).toBe("Ana asked Trippy to nudge Ben.");
    expect(reminderLine("Ana", ["Ben", "Cai"])).toBe("Ana asked Trippy to nudge Ben and Cai.");
    expect(reminderLine("Ana", ["Ben", "Cai", "Dee"])).toBe("Ana asked Trippy to nudge Ben, Cai and Dee.");
  });

  it("says nothing when nobody is waited for", () => {
    expect(reminderLine("Ana", [])).toBeNull();
  });

  it("carries the marker the throttle looks for, and the cooldown is minutes, not seconds", () => {
    expect(reminderLine("Ana", ["Ben"])).toContain(REMINDER_MARKER);
    expect(REMINDER_COOLDOWN_MS).toBe(300_000);
  });
});

describe("fallbackNudge", () => {
  it("asks a person to agree, and says agreeing costs nothing", () => {
    expect(fallbackNudge("Ben", "agree")).toBe("Ben, the plan is waiting for you to agree. Agreeing costs nothing and your money is not touched.");
  });

  it("asks a person to approve and add a card, and says nothing is charged yet", () => {
    const line = fallbackNudge("Ben", "approve");
    expect(line).toContain("approve your amount and add a card");
    expect(line).toContain("Nothing is charged until everyone is in");
  });
});
