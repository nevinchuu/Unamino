import type { Result } from "@/lib/result";
import type { PlanStatus } from "@/domain/plan/statuses";
import type { GroupError } from "./types";

/** What group management needs beyond the day-to-day group repository: how the group's plans stand, handing over the admin role, and removing the group. */
export interface GroupAdminStore {
  /** Every plan the group has made, with where it stands. */
  planStatuses(groupId: string): Promise<Result<readonly { readonly id: string; readonly status: PlanStatus }[], GroupError>>;
  /** Makes `toMemberId` the group's one admin and `fromMemberId` an ordinary member, in one step so the group is never without an admin. */
  transferOrganiser(groupId: string, fromMemberId: string, toMemberId: string): Promise<Result<void, GroupError>>;
  /** Removes the group and everything that hangs off it: members, messages, plans, covers and traveller details. */
  deleteGroup(groupId: string): Promise<Result<void, GroupError>>;
}
