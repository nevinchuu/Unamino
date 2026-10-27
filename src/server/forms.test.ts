import { describe, expect, it } from "vitest";
import { MAX_NAME_LENGTH, type GroupErrorCode } from "@/domain/group/types";
import { groupErrorMessage, parseCreateGroup, parseJoin } from "./forms";

const form = (fields: Record<string, string | File>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe("parseCreateGroup", () => {
  it("trims both names", () => {
    expect(parseCreateGroup(form({ groupName: "  Bangkok weekend ", yourName: " Nevin " }))).toEqual({ ok: true, value: { groupName: "Bangkok weekend", yourName: "Nevin" } });
  });

  it("explains each problem next to its field and hands back what was typed", () => {
    const result = parseCreateGroup(form({ groupName: "   ", yourName: "x".repeat(MAX_NAME_LENGTH + 1) }));
    expect(result).toEqual({
      ok: false,
      error: {
        fieldErrors: { groupName: "Enter a group name", yourName: `Use ${MAX_NAME_LENGTH} characters or fewer` },
        values: { groupName: "   ", yourName: "x".repeat(MAX_NAME_LENGTH + 1) },
      },
    });
  });

  it("treats a missing field and a file upload as empty", () => {
    const result = parseCreateGroup(form({ groupName: new File(["x"], "x.txt") }));
    expect(result.ok ? null : result.error.fieldErrors).toEqual({ groupName: "Enter a group name", yourName: "Enter your name" });
  });

  it("accepts a name exactly at the limit", () => {
    expect(parseCreateGroup(form({ groupName: "g".repeat(MAX_NAME_LENGTH), yourName: "n" })).ok).toBe(true);
  });
});

describe("parseJoin", () => {
  it("needs only a name", () => {
    expect(parseJoin(form({ yourName: "Ana" }))).toEqual({ ok: true, value: { yourName: "Ana" } });
    expect(parseJoin(form({})).ok).toBe(false);
  });

  it("ignores fields it was not asked for, so a crafted request cannot smuggle in a currency", () => {
    const result = parseJoin(form({ yourName: "Ana", currency: "EUR", isOrganiser: "true" }));
    expect(result).toEqual({ ok: true, value: { yourName: "Ana" } });
  });
});

describe("groupErrorMessage", () => {
  const codes: GroupErrorCode[] = ["invalid_input", "invalid_link", "group_full", "not_found", "forbidden", "unavailable"];

  it.each(codes)("has plain words for %s that never repeat the internal message", (code) => {
    const message = groupErrorMessage({ code, message: "internal detail postgres://secret" });
    expect(message.length).toBeGreaterThan(10);
    expect(message).not.toContain("internal");
    expect(message).not.toContain("postgres");
  });
});
