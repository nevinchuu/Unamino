import { and, asc, count, eq, gte } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import { generateToken, hashToken } from "@/lib/tokens";
import { MAX_GROUP_MEMBERS, MAX_NAME_LENGTH, type Group, type GroupError, type JoinLinkPreview, type Member } from "@/domain/group/types";
import type { CreatedGroup, GroupRepository, JoinedGroup, NewGroup } from "@/domain/group/repository";
import type { Database } from "./client";
import { groups, members } from "./schema";

type MemberRow = typeof members.$inferSelect;
type GroupRow = typeof groups.$inferSelect;

const CURRENCY = /^[A-Z]{3}$/;

const failure = (code: GroupError["code"], message: string): Result<never, GroupError> => err({ code, message });

/** Thrown inside a transaction to roll it back and carry a typed reason out. */
class Rollback extends Error {
  constructor(readonly reason: GroupError) {
    super(reason.message);
  }
}

const toGroup = (row: GroupRow): Group => ({ id: row.id, name: row.name, baseCurrency: row.baseCurrency });
export const toMember = (row: MemberRow): Member => ({
  id: row.id,
  groupId: row.groupId,
  displayName: row.displayName,
  currency: row.currency,
  isOrganiser: row.isOrganiser,
  ...(row.personaKey !== null && { personaKey: row.personaKey }),
});

/** Returns the reason a person's details are not acceptable, or null. */
function personProblem(person: { readonly displayName: string; readonly currency: string }): string | null {
  const name = person.displayName.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return `A name must be 1 to ${MAX_NAME_LENGTH} characters`;
  if (!CURRENCY.test(person.currency)) return "A currency must be a 3-letter code such as USD";
  return null;
}

/** Stores groups and who is in them. Secrets are only ever stored as hashes. */
export class PostgresGroupRepository implements GroupRepository {
  /** How many groups were made since a moment, for the limit on making them. Not part of what the app asks of a group. */
  async createdSince(since: Date): Promise<number> {
    const [row] = await this.db.select({ total: count() }).from(groups).where(gte(groups.createdAt, since));
    return row.total;
  }

  constructor(private readonly db: Database) {}

  async create(input: NewGroup): Promise<Result<CreatedGroup, GroupError>> {
    const name = input.name.trim();
    if (name.length === 0 || name.length > MAX_NAME_LENGTH) return failure("invalid_input", `A group name must be 1 to ${MAX_NAME_LENGTH} characters`);
    if (!CURRENCY.test(input.baseCurrency)) return failure("invalid_input", "A currency must be a 3-letter code such as USD");
    const problem = personProblem(input.organiser);
    if (problem) return failure("invalid_input", problem);

    const joinToken = generateToken();
    const memberToken = generateToken();
    try {
      return await this.db.transaction(async (tx) => {
        const [group] = await tx.insert(groups).values({ name, baseCurrency: input.baseCurrency, joinTokenHash: hashToken(joinToken) }).returning();
        const [organiser] = await tx
          .insert(members)
          .values({ groupId: group.id, displayName: input.organiser.displayName.trim(), currency: input.organiser.currency, status: "joined", joinedAt: new Date(), isOrganiser: true, inviteTokenHash: hashToken(memberToken) })
          .returning();
        return ok({ group: toGroup(group), organiser: toMember(organiser), memberToken, joinToken });
      });
    } catch {
      return failure("unavailable", "The database could not be reached");
    }
  }

  async joinWithLink(joinToken: string, person: { readonly displayName: string; readonly currency: string }): Promise<Result<JoinedGroup, GroupError>> {
    const problem = personProblem(person);
    if (problem) return failure("invalid_input", problem);

    const memberToken = generateToken();
    try {
      return await this.db.transaction(async (tx) => {
        // Locked so two people taking the last place cannot both get it.
        const [group] = await tx.select().from(groups).where(eq(groups.joinTokenHash, hashToken(joinToken))).for("update").limit(1);
        if (!group || !group.joinEnabled) throw new Rollback({ code: "invalid_link", message: "This join link is not valid any more" });

        const [{ total }] = await tx.select({ total: count() }).from(members).where(and(eq(members.groupId, group.id), eq(members.status, "joined")));
        if (total >= MAX_GROUP_MEMBERS) throw new Rollback({ code: "group_full", message: `This group already has ${MAX_GROUP_MEMBERS} people` });

        const [member] = await tx
          .insert(members)
          .values({ groupId: group.id, displayName: person.displayName.trim(), currency: person.currency, status: "joined", joinedAt: new Date(), inviteTokenHash: hashToken(memberToken) })
          .returning();
        return ok({ group: toGroup(group), member: toMember(member), memberToken });
      });
    } catch (error) {
      if (error instanceof Rollback) return err(error.reason);
      return failure("unavailable", "The database could not be reached");
    }
  }

  async describeJoinLink(joinToken: string): Promise<Result<JoinLinkPreview, GroupError>> {
    try {
      const [group] = await this.db.select().from(groups).where(eq(groups.joinTokenHash, hashToken(joinToken))).limit(1);
      if (!group || !group.joinEnabled) return failure("invalid_link", "This join link is not valid any more");

      const joined = await this.db.select({ name: members.displayName, isOrganiser: members.isOrganiser }).from(members).where(and(eq(members.groupId, group.id), eq(members.status, "joined")));
      return ok({
        groupId: group.id,
        groupName: group.name,
        inviterName: joined.find((member) => member.isOrganiser)?.name ?? null,
        memberCount: joined.length,
        isFull: joined.length >= MAX_GROUP_MEMBERS,
      });
    } catch {
      return failure("unavailable", "The database could not be reached");
    }
  }

  async authenticate(memberToken: string): Promise<Result<Member, GroupError>> {
    try {
      const [row] = await this.db.select().from(members).where(and(eq(members.inviteTokenHash, hashToken(memberToken)), eq(members.status, "joined"))).limit(1);
      return row ? ok(toMember(row)) : failure("not_found", "Nobody is signed in with that token");
    } catch {
      return failure("unavailable", "The database could not be reached");
    }
  }

  async find(groupId: string): Promise<Result<Group, GroupError>> {
    try {
      const [row] = await this.db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
      return row ? ok(toGroup(row)) : failure("not_found", "There is no such group");
    } catch {
      return failure("unavailable", "The database could not be reached");
    }
  }

  async memberNames(groupId: string): Promise<ReadonlyMap<string, string>> {
    const rows = await this.db.select({ id: members.id, displayName: members.displayName }).from(members).where(eq(members.groupId, groupId));
    return new Map(rows.map((row) => [row.id, row.displayName]));
  }

  async joinedMembers(groupId: string): Promise<readonly Member[]> {
    const rows = await this.db.select().from(members).where(and(eq(members.groupId, groupId), eq(members.status, "joined"))).orderBy(asc(members.joinedAt), asc(members.id));
    return rows.map(toMember);
  }

  async leave(memberId: string): Promise<Result<void, GroupError>> {
    try {
      const [row] = await this.db.select().from(members).where(eq(members.id, memberId)).limit(1);
      if (!row) return failure("not_found", "There is no such member");
      // Someone has to be able to turn the join link off, so the organiser stays.
      if (row.isOrganiser) return failure("forbidden", "The organiser cannot leave their own group");
      await this.db.update(members).set({ status: "left", leftAt: new Date() }).where(and(eq(members.id, memberId), eq(members.status, "joined")));
      return ok(undefined);
    } catch {
      return failure("unavailable", "The database could not be reached");
    }
  }

  async replaceMemberToken(memberId: string): Promise<Result<string, GroupError>> {
    const memberToken = generateToken();
    try {
      const updated = await this.db
        .update(members)
        .set({ inviteTokenHash: hashToken(memberToken) })
        .where(and(eq(members.id, memberId), eq(members.status, "joined")))
        .returning({ id: members.id });
      return updated.length === 1 ? ok(memberToken) : failure("not_found", "There is no such member");
    } catch {
      return failure("unavailable", "The database could not be reached");
    }
  }

  async replaceJoinLink(groupId: string, actingMemberId: string): Promise<Result<string, GroupError>> {
    const allowed = await this.requireOrganiser(groupId, actingMemberId);
    if (!allowed.ok) return allowed;
    const joinToken = generateToken();
    try {
      await this.db.update(groups).set({ joinTokenHash: hashToken(joinToken), joinEnabled: true }).where(eq(groups.id, groupId));
      return ok(joinToken);
    } catch {
      return failure("unavailable", "The database could not be reached");
    }
  }

  async disableJoinLink(groupId: string, actingMemberId: string): Promise<Result<void, GroupError>> {
    const allowed = await this.requireOrganiser(groupId, actingMemberId);
    if (!allowed.ok) return allowed;
    try {
      await this.db.update(groups).set({ joinEnabled: false }).where(eq(groups.id, groupId));
      return ok(undefined);
    } catch {
      return failure("unavailable", "The database could not be reached");
    }
  }

  private async requireOrganiser(groupId: string, memberId: string): Promise<Result<void, GroupError>> {
    try {
      const [row] = await this.db.select().from(members).where(and(eq(members.id, memberId), eq(members.groupId, groupId), eq(members.status, "joined"))).limit(1);
      return row?.isOrganiser ? ok(undefined) : failure("forbidden", "Only the organiser can change the join link");
    } catch {
      return failure("unavailable", "The database could not be reached");
    }
  }
}
