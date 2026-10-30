import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import { generateToken } from "@/lib/tokens";
import type { Member } from "@/domain/group/types";
import { lookUpAccessLink, runMakeAccessLink } from "./access-link";

const GROUP = "3f2b8c1e-5a4d-4e0b-9c7a-1d2e3f4a5b6c";
const ana: Member = { id: "ana", groupId: GROUP, displayName: "Ana", currency: "USD", isOrganiser: false };

describe("runMakeAccessLink", () => {
  it("gives the person a new secret for their own sign-in", async () => {
    const asked: string[] = [];
    const groups = { replaceMemberToken: async (id: string) => (asked.push(id), ok("new-secret")) };
    expect(await runMakeAccessLink({ groups }, ana, GROUP)).toEqual({ ok: true, token: "new-secret" });
    expect(asked).toEqual(["ana"]);
  });

  it("is for someone signed in to this group, and touches nothing otherwise", async () => {
    const asked: string[] = [];
    const groups = { replaceMemberToken: async (id: string) => (asked.push(id), ok("x")) };
    expect(await runMakeAccessLink({ groups }, null, GROUP)).toEqual({ ok: false, error: "Open your invite link to rejoin this group." });
    expect(await runMakeAccessLink({ groups }, { ...ana, groupId: "other" }, GROUP)).toEqual({ ok: false, error: "Open your invite link to rejoin this group." });
    expect(asked).toEqual([]);
  });

  it("says to try again when the secret could not be made, without the reason", async () => {
    const groups = { replaceMemberToken: async () => err({ code: "unavailable" as const, message: "SECRET db detail" }) };
    expect(await runMakeAccessLink({ groups }, ana, GROUP)).toEqual({ ok: false, error: "Something went wrong on our side. Try again in a moment." });
  });
});

describe("lookUpAccessLink", () => {
  const token = generateToken();
  const groups = {
    authenticate: async (candidate: string) => (candidate === token ? ok(ana) : err({ code: "not_found" as const, message: "no" })),
    find: async (id: string) => (id === GROUP ? ok({ id, name: "Bangkok trip", baseCurrency: "USD" }) : err({ code: "not_found" as const, message: "no" })),
  };

  it("says who the link signs in and where, without changing anything", async () => {
    expect(await lookUpAccessLink({ groups }, token)).toEqual({ ok: true, preview: { groupId: GROUP, groupName: "Bangkok trip", memberName: "Ana" } });
  });

  it("does not work for a secret that was replaced, or one nobody holds", async () => {
    expect(await lookUpAccessLink({ groups }, generateToken())).toEqual({ ok: false });
  });

  it("turns away something that is not token-shaped without asking the database", async () => {
    let asked = 0;
    const counting = { ...groups, authenticate: async (candidate: string) => (asked++, groups.authenticate(candidate)) };
    for (const junk of ["", "abc", "x".repeat(44), `${token}!`, "../../etc"]) expect(await lookUpAccessLink({ groups: counting }, junk)).toEqual({ ok: false });
    expect(asked).toBe(0);
  });

  it("does not work when the group is gone", async () => {
    const gone = { ...groups, find: async () => err({ code: "not_found" as const, message: "no" }) };
    expect(await lookUpAccessLink({ groups: gone }, token)).toEqual({ ok: false });
  });
});
