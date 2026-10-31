import { describe, expect, it } from "vitest";
import { changeRequestText, cleanNote, isChangeReason, isChangeRequestText, NOTE_MAX } from "./change-request";

describe("changeRequestText", () => {
  it("calls Trippy and asks for the plan to be changed, saying why", () => {
    expect(changeRequestText("different_dates", "", null)).toBe("@trippy I need changes to the plan: the dates do not work for me.");
  });

  it("adds the person's own share when the reason is the price, and only then", () => {
    expect(changeRequestText("too_expensive", "", "$300.67")).toBe("@trippy I need changes to the plan: it is too expensive for me (my share is $300.67).");
    expect(changeRequestText("different_pick", "", "$300.67")).not.toContain("$300.67");
  });

  it("puts the note at the end", () => {
    expect(changeRequestText("other", "leave a day later", null)).toBe("@trippy I need changes to the plan: something needs to change. leave a day later");
  });
});

describe("isChangeRequestText", () => {
  it("recognises what changeRequestText writes, and an ordinary message to Trippy is not one", () => {
    expect(isChangeRequestText(changeRequestText("other", "later please", null))).toBe(true);
    expect(isChangeRequestText("@trippy anything new?")).toBe(false);
  });
});

describe("cleanNote", () => {
  it("keeps a note to one line, trimmed", () => {
    expect(cleanNote("  under\n\n 200   please \t")).toBe("under 200 please");
  });

  it("cuts a long note to the limit", () => {
    expect(cleanNote("x".repeat(NOTE_MAX + 50))).toHaveLength(NOTE_MAX);
  });

  it("treats anything that is not text as no note", () => {
    expect(cleanNote(undefined)).toBe("");
    expect(cleanNote({ a: 1 })).toBe("");
  });
});

describe("isChangeReason", () => {
  it("accepts the four reasons and nothing else", () => {
    for (const reason of ["too_expensive", "different_dates", "different_pick", "other"]) expect(isChangeReason(reason)).toBe(true);
    for (const reason of ["", "cancel", null, 3]) expect(isChangeReason(reason)).toBe(false);
  });
});
