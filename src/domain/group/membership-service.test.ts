import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "@/lib/result";
import type { PlanStatus } from "@/domain/plan/statuses";
import { approved, memberSnapshot, NOW, setup } from "@/domain/plan/test-support";
import type { GroupAdminStore } from "./admin-store";
import { MembershipService, type MembershipError } from "./membership-service";
import type { Group, GroupError, Member } from "./types";

const GROUP = "g1";
const member = (id: string, displayName: string, isOrganiser = false): Member => ({ id, groupId: GROUP, displayName, currency: "USD", isOrganiser });
const ana = member("ana", "Ana", true);
const ben = member("ben", "Ben");
const cai = member("cai", "Cai");

class FakeGroups {
  people: Member[];
  leaveCalls: string[] = [];
  constructor(people: Member[]) {
    this.people = people;
  }
  async find(): Promise<Result<Group, GroupError>> {
    return ok({ id: GROUP, name: "Bangkok trip", baseCurrency: "USD" });
  }
  async joinedMembers(): Promise<readonly Member[]> {
    return this.people;
  }
  async leave(memberId: string): Promise<Result<void, GroupError>> {
    this.leaveCalls.push(memberId);
    this.people = this.people.filter((person) => person.id !== memberId);
    return ok(undefined);
  }
  async replaceJoinLink(): Promise<Result<string, GroupError>> {
    return ok("new-secret");
  }
}

class FakeAdmin implements GroupAdminStore {
  transfers: [string, string][] = [];
  deleted = false;
  constructor(public statuses: { id: string; status: PlanStatus }[] = []) {}
  async planStatuses() {
    return ok(this.statuses);
  }
  async transferOrganiser(_group: string, from: string, to: string): Promise<Result<void, GroupError>> {
    this.transfers.push([from, to]);
    return ok(undefined);
  }
  async deleteGroup(): Promise<Result<void, GroupError>> {
    this.deleted = true;
    return ok(undefined);
  }
}

function world(options: { people?: Member[]; planStatus?: PlanStatus; statuses?: { id: string; status: PlanStatus }[]; adminDown?: boolean } = {}) {
  const planStatus = options.planStatus ?? "approving";
  const s = setup({ status: planStatus, members: [approved("ana"), approved("ben"), memberSnapshot("cai")] });
  const groups = new FakeGroups(options.people ?? [ana, ben, cai]);
  const admin = new FakeAdmin(options.statuses ?? [{ id: "plan-1", status: planStatus }]);
  const said: string[] = [];
  const service = new MembershipService({
    groups,
    admin,
    plans: s.plans,
    effects: s.effects,
    messages: { postSystem: async (_group, body) => (said.push(body), ok({ id: "m", seq: 1, groupId: GROUP, memberId: null, kind: "system" as const, body, replyToMessageId: null, mentionsAgent: false, planId: null, createdAt: NOW })) },
    clock: () => NOW,
  });
  return { ...s, groups, admin, said, service };
}

const failedWith = (result: Result<unknown, MembershipError>): string | null => (result.ok ? null : result.error.kind);

describe("MembershipService", () => {
  describe("leave", () => {
    it("takes a member out and tells the group", async () => {
      const w = world({ statuses: [] });
      expect(await w.service.leave(ben)).toEqual({ ok: true, value: { planEnded: false } });
      expect(w.groups.leaveCalls).toEqual(["ben"]);
      expect(w.said).toEqual(["Ben left the group."]);
    });

    it("ends the open plan and lets go of the card holds, because the people in it have changed", async () => {
      const w = world({ planStatus: "approving" });
      const result = await w.service.leave(ben);
      expect(result).toEqual({ ok: true, value: { planEnded: true } });
      expect(w.plans.plan.status).toBe("expired");
      expect(w.effects.types).toContain("release_holds");
      expect(w.said).toEqual(["Ben left the group. The plan ended and every card hold was released. Mention @trippy to plan again."]);
    });

    it("will not let the group admin just leave, and changes nothing", async () => {
      const w = world();
      expect(failedWith(await w.service.leave(ana))).toBe("hand_over");
      expect(w.groups.leaveCalls).toEqual([]);
      expect(w.plans.plan.status).toBe("approving");
      expect(w.said).toEqual([]);
    });

    it.each<PlanStatus>(["booking", "booked", "captured"])("is refused once a trip is %s, and nothing is touched", async (status) => {
      const w = world({ statuses: [{ id: "plan-1", status }] });
      expect(failedWith(await w.service.leave(ben))).toBe("locked");
      expect(w.groups.leaveCalls).toEqual([]);
      expect(w.plans.plan.status).toBe("approving");
    });

    it("is refused when booking starts in the moment between looking and ending the plan", async () => {
      const w = world({ planStatus: "booking", statuses: [{ id: "plan-1", status: "approving" }] });
      expect(failedWith(await w.service.leave(ben))).toBe("locked");
      expect(w.groups.leaveCalls).toEqual([]);
    });

    it("still goes through when a plan was already closed by someone else", async () => {
      const w = world({ planStatus: "expired", statuses: [{ id: "plan-1", status: "reviewing" }] });
      expect(await w.service.leave(ben)).toEqual({ ok: true, value: { planEnded: false } });
      expect(w.groups.leaveCalls).toEqual(["ben"]);
    });

    it("still ends the plan when a card hold could not be released at once; the retrier finishes that", async () => {
      const w = world({ planStatus: "approving" });
      w.effects.failWith = { message: "stripe down" };
      expect(await w.service.leave(ben)).toEqual({ ok: true, value: { planEnded: true } });
      expect(w.plans.plan.status).toBe("expired");
    });
  });

  describe("remove", () => {
    it("lets only the admin remove people", async () => {
      const w = world();
      expect(failedWith(await w.service.remove(ben, "cai", { resetLink: false }))).toBe("not_admin");
      expect(w.groups.leaveCalls).toEqual([]);
    });

    it("removes the person, ends the open plan and names who did it", async () => {
      const w = world();
      expect(await w.service.remove(ana, "ben", { resetLink: false })).toEqual({ ok: true, value: { planEnded: true } });
      expect(w.groups.leaveCalls).toEqual(["ben"]);
      expect(w.said[0]).toBe("Ana removed Ben from the group. The plan ended and every card hold was released. Mention @trippy to plan again.");
    });

    it("makes a new invite link when asked, so the person cannot rejoin with the old one", async () => {
      const w = world({ statuses: [] });
      expect(await w.service.remove(ana, "ben", { resetLink: true })).toEqual({ ok: true, value: { planEnded: false, newJoinToken: "new-secret" } });
    });

    it("cannot remove the admin themself, or someone who is not in the group", async () => {
      const w = world();
      expect(failedWith(await w.service.remove(ana, "ana", { resetLink: false }))).toBe("hand_over");
      expect(failedWith(await w.service.remove(ana, "nobody", { resetLink: false }))).toBe("not_found");
      expect(w.groups.leaveCalls).toEqual([]);
    });

    it("is refused once a trip is booked", async () => {
      const w = world({ statuses: [{ id: "plan-1", status: "booked" }] });
      expect(failedWith(await w.service.remove(ana, "ben", { resetLink: false }))).toBe("locked");
      expect(w.groups.leaveCalls).toEqual([]);
    });
  });

  describe("makeAdmin", () => {
    it("hands the role over and says so in the chat", async () => {
      const w = world();
      expect(await w.service.makeAdmin(ana, "ben")).toEqual({ ok: true, value: undefined });
      expect(w.admin.transfers).toEqual([["ana", "ben"]]);
      expect(w.said).toEqual(["Ana made Ben the group admin."]);
    });

    it("is for the admin only, and only for someone in the group", async () => {
      const w = world();
      expect(failedWith(await w.service.makeAdmin(ben, "cai"))).toBe("not_admin");
      expect(failedWith(await w.service.makeAdmin(ana, "nobody"))).toBe("not_found");
      expect(failedWith(await w.service.makeAdmin(ana, "ana"))).toBe("not_found");
      expect(w.admin.transfers).toEqual([]);
    });

    it("works even after a trip is booked, because it moves no money", async () => {
      const w = world({ statuses: [{ id: "plan-1", status: "booked" }] });
      expect((await w.service.makeAdmin(ana, "ben")).ok).toBe(true);
    });
  });

  describe("deleteGroup", () => {
    it("deletes only when the exact group name is typed", async () => {
      const w = world({ statuses: [] });
      expect(failedWith(await w.service.deleteGroup(ana, "bangkok trip"))).toBe("name_mismatch");
      expect(failedWith(await w.service.deleteGroup(ana, ""))).toBe("name_mismatch");
      expect(w.admin.deleted).toBe(false);
      expect((await w.service.deleteGroup(ana, "  Bangkok trip  ")).ok).toBe(true);
      expect(w.admin.deleted).toBe(true);
    });

    it("ends the open plan and lets go of the holds before deleting", async () => {
      const w = world({ planStatus: "approving" });
      expect((await w.service.deleteGroup(ana, "Bangkok trip")).ok).toBe(true);
      expect(w.plans.plan.status).toBe("expired");
      expect(w.effects.types).toContain("release_holds");
      expect(w.admin.deleted).toBe(true);
    });

    it("is for the admin only", async () => {
      const w = world();
      expect(failedWith(await w.service.deleteGroup(ben, "Bangkok trip"))).toBe("not_admin");
      expect(w.admin.deleted).toBe(false);
    });

    it("is refused once a trip is booked, and deletes nothing", async () => {
      const w = world({ statuses: [{ id: "plan-1", status: "captured" }] });
      expect(failedWith(await w.service.deleteGroup(ana, "Bangkok trip"))).toBe("locked");
      expect(w.admin.deleted).toBe(false);
    });

    it("tells a store failure apart from a refusal, and deletes nothing", async () => {
      const w = world({ statuses: [] });
      w.admin.deleteGroup = async () => err({ code: "unavailable", message: "db" });
      expect(failedWith(await w.service.deleteGroup(ana, "Bangkok trip"))).toBe("unavailable");
    });
  });
});
