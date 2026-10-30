import { describe, expect, it } from "vitest";
import { err, ok } from "@/lib/result";
import type { Member } from "@/domain/group/types";
import { runDeleteGroup, runIssueAccessLink, runLeave, runMakeAdmin, runRemove, type MembershipActionDeps } from "./membership-actions";

const GROUP = "3f2b8c1e-5a4d-4e0b-9c7a-1d2e3f4a5b6c";
const OTHER_GROUP = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const BEN_ID = "11111111-2222-4333-8444-555555555555";
const admin: Member = { id: "a", groupId: GROUP, displayName: "Ana", currency: "USD", isOrganiser: true };
const stranger: Member = { ...admin, groupId: OTHER_GROUP };

function setup(refusal: string | null = null) {
  const calls: { method: string; args: unknown[] }[] = [];
  const answer = (method: string, value: unknown) => async (...args: unknown[]) => (calls.push({ method, args }), refusal ? err({ kind: "locked" as const, message: refusal }) : ok(value));
  const deps: MembershipActionDeps = {
    membership: {
      leave: answer("leave", { planEnded: true }),
      remove: answer("remove", { planEnded: false, newJoinToken: "secret" }),
      makeAdmin: answer("makeAdmin", undefined),
      deleteGroup: answer("deleteGroup", undefined),
      issueAccessLink: answer("issueAccessLink", "new-secret"),
    } as unknown as MembershipActionDeps["membership"],
  };
  return { deps, calls };
}

describe("membership actions", () => {
  it("answer 'open your invite link' to someone who is not signed in, and do nothing", async () => {
    const { deps, calls } = setup();
    for (const result of [
      await runLeave(deps, null, GROUP),
      await runRemove(deps, null, { groupId: GROUP, targetMemberId: BEN_ID, resetLink: false }),
      await runMakeAdmin(deps, null, { groupId: GROUP, targetMemberId: BEN_ID }),
      await runDeleteGroup(deps, null, { groupId: GROUP, typedName: "x" }),
    ]) {
      expect(result).toEqual({ ok: false, error: "Open your invite link to rejoin this group." });
    }
    expect(calls).toEqual([]);
  });

  it("do not let a member of another group act on this one", async () => {
    const { deps, calls } = setup();
    expect((await runLeave(deps, stranger, GROUP)).ok).toBe(false);
    expect((await runDeleteGroup(deps, stranger, { groupId: GROUP, typedName: "x" })).ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("leave passes the person through and reports whether a plan ended", async () => {
    const { deps, calls } = setup();
    expect(await runLeave(deps, admin, GROUP)).toEqual({ ok: true, planEnded: true });
    expect(calls[0]).toEqual({ method: "leave", args: [admin] });
  });

  it("remove hands back the new invite secret when the link was replaced", async () => {
    const { deps, calls } = setup();
    expect(await runRemove(deps, admin, { groupId: GROUP, targetMemberId: BEN_ID, resetLink: true })).toEqual({ ok: true, planEnded: false, joinToken: "secret" });
    expect(calls[0].args).toEqual([admin, BEN_ID, { resetLink: true }]);
  });

  it("refuse an id that is not an id, without asking the service", async () => {
    const { deps, calls } = setup();
    expect((await runRemove(deps, admin, { groupId: GROUP, targetMemberId: "not-an-id", resetLink: false })).ok).toBe(false);
    expect((await runMakeAdmin(deps, admin, { groupId: GROUP, targetMemberId: "x" })).ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("hands back the new access secret once, and asks about the person named", async () => {
    const { deps, calls } = setup();
    expect(await runIssueAccessLink(deps, admin, { groupId: GROUP, targetMemberId: BEN_ID })).toEqual({ ok: true, accessToken: "new-secret" });
    expect(calls[0]).toEqual({ method: "issueAccessLink", args: [admin, BEN_ID] });
  });

  it("refuses a re-issue from someone not signed in, from another group, or for an id that is not an id", async () => {
    const { deps, calls } = setup();
    expect((await runIssueAccessLink(deps, null, { groupId: GROUP, targetMemberId: BEN_ID })).ok).toBe(false);
    expect((await runIssueAccessLink(deps, stranger, { groupId: GROUP, targetMemberId: BEN_ID })).ok).toBe(false);
    expect((await runIssueAccessLink(deps, admin, { groupId: GROUP, targetMemberId: "nope" })).ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("make admin and delete pass through", async () => {
    const { deps, calls } = setup();
    expect(await runMakeAdmin(deps, admin, { groupId: GROUP, targetMemberId: BEN_ID })).toEqual({ ok: true });
    expect(await runDeleteGroup(deps, admin, { groupId: GROUP, typedName: "Bangkok" })).toEqual({ ok: true });
    expect(calls.map((call) => call.method)).toEqual(["makeAdmin", "deleteGroup"]);
  });

  it("show the service's reason in plain words when it refuses", async () => {
    const { deps } = setup("This trip is booked.");
    expect(await runLeave(deps, admin, GROUP)).toEqual({ ok: false, error: "This trip is booked." });
    expect(await runDeleteGroup(deps, admin, { groupId: GROUP, typedName: "x" })).toEqual({ ok: false, error: "This trip is booked." });
  });
});
