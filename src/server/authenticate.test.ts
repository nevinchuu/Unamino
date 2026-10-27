import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import type { Member } from "@/domain/group/types";
import { authenticateInGroup } from "./authenticate";

const member = (groupId: string): Member => ({ id: "m1", groupId, displayName: "Ana", currency: "USD", isOrganiser: false });
const knows = (token: string, groupId: string) => ({
  authenticate: async (given: string) => (given === token ? ok(member(groupId)) : err({ code: "forbidden" as const, message: "no" })),
});

describe("authenticateInGroup", () => {
  it("recognises a member of this group", async () => {
    expect(await authenticateInGroup(knows("tok", "g1"), "g1", "tok")).toEqual(member("g1"));
  });

  it("does not let a token from another group open this one", async () => {
    expect(await authenticateInGroup(knows("tok", "g2"), "g1", "tok")).toBeNull();
  });

  it("recognises nobody without a token, without asking the store", async () => {
    let asked = false;
    const groups = { authenticate: async () => (asked = true, ok(member("g1"))) };
    expect(await authenticateInGroup(groups, "g1", undefined)).toBeNull();
    expect(await authenticateInGroup(groups, "g1", "")).toBeNull();
    expect(asked).toBe(false);
  });

  it("recognises nobody for an unknown token", async () => {
    expect(await authenticateInGroup(knows("tok", "g1"), "g1", "other")).toBeNull();
  });
});
