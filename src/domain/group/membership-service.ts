import { err, ok, type Result } from "@/lib/result";
import { applyPlanEvent } from "@/domain/plan/apply-event";
import type { EffectRunner } from "@/domain/plan/effects";
import type { PlanRepository } from "@/domain/plan/repository";
import { EXPIRABLE_PLAN_STATUSES, type PlanStatus } from "@/domain/plan/statuses";
import type { GroupAdminStore } from "./admin-store";
import type { GroupRepository, MessageRepository } from "./repository";
import type { Member } from "./types";

/**
 * "not_admin": only the group admin can do this. "hand_over": the admin cannot just leave. "locked": a trip has been
 * booked or is being booked, so nobody can come or go. "not_found": the person is not in this group (any more).
 * "name_mismatch": the group name typed to confirm a delete was not the group's name. "unavailable": nothing changed, or
 * not all of it; try again.
 */
export type MembershipErrorKind = "not_admin" | "hand_over" | "locked" | "not_found" | "name_mismatch" | "unavailable";

export interface MembershipError {
  readonly kind: MembershipErrorKind;
  readonly message: string;
}

export interface MembershipDeps {
  readonly groups: Pick<GroupRepository, "find" | "joinedMembers" | "leave" | "replaceJoinLink">;
  readonly admin: GroupAdminStore;
  readonly plans: PlanRepository;
  readonly effects: EffectRunner;
  readonly messages: Pick<MessageRepository, "postSystem">;
  readonly clock: () => Date;
}

/** `planEnded`: an open plan was ended because the people in it changed. `newJoinToken`: the invite link was replaced, shown once. */
export interface MembershipOutcome {
  readonly planEnded: boolean;
  readonly newJoinToken?: string;
}

/** Once booking has begun, suppliers hold bookings and money has moved, so the group is frozen. */
const LOCKED_PLAN_STATUSES: readonly PlanStatus[] = ["booking", "booked", "captured"];

const LOCKED: MembershipError = { kind: "locked", message: "This trip is booked, so nobody can leave, be removed or delete the group." };
const NOT_ADMIN: MembershipError = { kind: "not_admin", message: "Only the group admin can do this." };
const UNAVAILABLE: MembershipError = { kind: "unavailable", message: "Something went wrong on our side. Try again in a moment." };

/**
 * Who is in a group, and who runs it: leaving, removing someone, handing the admin role on, and deleting the group.
 * It trusts that `actor` is who they say (the caller checked their token), and checks everything else itself: that they
 * are the admin where that matters, that the group is not frozen by a booking, and that an open plan is ended first,
 * with its card holds released, because the people it was made for have changed.
 */
export class MembershipService {
  constructor(private readonly deps: MembershipDeps) {}

  async leave(actor: Member): Promise<Result<MembershipOutcome, MembershipError>> {
    if (actor.isOrganiser) {
      return err({ kind: "hand_over", message: "You're the group admin. Make someone else the admin first, or delete the group." });
    }
    const ended = await this.endOpenPlans(actor.groupId);
    if (!ended.ok) return ended;
    const left = await this.deps.groups.leave(actor.id);
    if (!left.ok) return err(UNAVAILABLE);
    await this.announce(actor.groupId, `${actor.displayName} left the group.`, ended.value);
    return ok({ planEnded: ended.value });
  }

  async remove(actor: Member, targetMemberId: string, options: { readonly resetLink: boolean }): Promise<Result<MembershipOutcome, MembershipError>> {
    if (!actor.isOrganiser) return err(NOT_ADMIN);
    const target = await this.findPerson(actor.groupId, targetMemberId);
    if (!target.ok) return target;
    if (target.value.id === actor.id) return err({ kind: "hand_over", message: "You can't remove yourself. Make someone else the admin and exit, or delete the group." });

    const ended = await this.endOpenPlans(actor.groupId);
    if (!ended.ok) return ended;
    const left = await this.deps.groups.leave(target.value.id);
    if (!left.ok) return err(UNAVAILABLE);
    await this.announce(actor.groupId, `${actor.displayName} removed ${target.value.displayName} from the group.`, ended.value);

    if (!options.resetLink) return ok({ planEnded: ended.value });
    // The link never expires, so without a new one the person could simply join again.
    const replaced = await this.deps.groups.replaceJoinLink(actor.groupId, actor.id);
    return replaced.ok ? ok({ planEnded: ended.value, newJoinToken: replaced.value }) : ok({ planEnded: ended.value });
  }

  async makeAdmin(actor: Member, targetMemberId: string): Promise<Result<void, MembershipError>> {
    if (!actor.isOrganiser) return err(NOT_ADMIN);
    const target = await this.findPerson(actor.groupId, targetMemberId);
    if (!target.ok) return target;
    if (target.value.id === actor.id) return err({ kind: "not_found", message: "You're already the group admin." });

    const moved = await this.deps.admin.transferOrganiser(actor.groupId, actor.id, target.value.id);
    if (!moved.ok) return err(UNAVAILABLE);
    await this.deps.messages.postSystem(actor.groupId, `${actor.displayName} made ${target.value.displayName} the group admin.`);
    return ok(undefined);
  }

  /** `typedName` is what the admin typed to confirm. Nothing is touched unless it is exactly the group's name. */
  async deleteGroup(actor: Member, typedName: string): Promise<Result<void, MembershipError>> {
    if (!actor.isOrganiser) return err(NOT_ADMIN);
    const group = await this.deps.groups.find(actor.groupId);
    if (!group.ok) return err(group.error.code === "not_found" ? { kind: "not_found", message: "This group doesn't exist any more." } : UNAVAILABLE);
    if (typedName.trim() !== group.value.name) return err({ kind: "name_mismatch", message: "That isn't the group's name." });

    const ended = await this.endOpenPlans(actor.groupId);
    if (!ended.ok) return ended;
    const deleted = await this.deps.admin.deleteGroup(actor.groupId);
    return deleted.ok ? ok(undefined) : err(UNAVAILABLE);
  }

  private async findPerson(groupId: string, memberId: string): Promise<Result<Member, MembershipError>> {
    const people = await this.deps.groups.joinedMembers(groupId);
    const person = people.find((member) => member.id === memberId);
    return person ? ok(person) : err({ kind: "not_found", message: "That person isn't in the group." });
  }

  /**
   * Ends the group's open plans and lets go of their card holds, or refuses if any trip is already being booked. Returns
   * whether a plan was ended. A hold that could not be released now is left to the effect retrier, so the plan still ends.
   */
  private async endOpenPlans(groupId: string): Promise<Result<boolean, MembershipError>> {
    const statuses = await this.deps.admin.planStatuses(groupId);
    if (!statuses.ok) return err(UNAVAILABLE);
    if (statuses.value.some((plan) => LOCKED_PLAN_STATUSES.includes(plan.status))) return err(LOCKED);

    let ended = false;
    for (const plan of statuses.value.filter((candidate) => EXPIRABLE_PLAN_STATUSES.includes(candidate.status))) {
      const applied = await applyPlanEvent(this.deps.plans, plan.id, { type: "plan_replaced", at: this.deps.clock() });
      if (!applied.ok) {
        // Booking started a moment ago: the same freeze as above. Any other refusal means the plan is already closed.
        if (applied.error.kind === "transition" && applied.error.error.code === "booking_in_progress") return err(LOCKED);
        if (applied.error.kind === "repository") return err(UNAVAILABLE);
        continue;
      }
      ended = true;
      if (applied.value.effects.length > 0) await this.deps.effects.run(plan.id, applied.value.version, applied.value.effects);
    }
    return ok(ended);
  }

  private async announce(groupId: string, line: string, planEnded: boolean): Promise<void> {
    const note = planEnded ? " The plan ended and every card hold was released. Mention @trippy to plan again." : "";
    await this.deps.messages.postSystem(groupId, `${line}${note}`);
  }
}
