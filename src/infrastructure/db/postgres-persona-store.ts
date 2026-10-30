import { and, count, eq, gte, isNotNull } from "drizzle-orm";
import { err, ok, type Result } from "@/lib/result";
import { generateToken, hashToken } from "@/lib/tokens";
import { MAX_GROUP_MEMBERS, type Member } from "@/domain/group/types";
import type { PersonaError, PersonaStore } from "@/domain/persona/ports";
import type { PersonaProfile } from "@/domain/persona/profiles";
import type { Database } from "./client";
import { toMember } from "./postgres-group-repository";
import { groups, members, messages } from "./schema";

/** Thrown inside a transaction to roll it back and carry a typed reason out. */
class Rollback extends Error {
  constructor(readonly reason: PersonaError) {
    super(reason.message);
  }
}

/** Stores the simulated test personas of a group. A persona is a member with a key and a secret nobody ever holds, so it cannot sign in. */
export class PostgresPersonaStore implements PersonaStore {
  constructor(private readonly db: Database) {}

  async add(groupId: string, personas: readonly PersonaProfile[], maxPersonas: number): Promise<Result<readonly Member[], PersonaError>> {
    try {
      return await this.db.transaction(async (tx) => {
        // Locked so two people adding at once cannot take the same last places.
        const [group] = await tx.select().from(groups).where(eq(groups.id, groupId)).for("update").limit(1);
        if (!group) throw new Rollback({ kind: "unavailable", message: "This group doesn't exist any more." });

        const joined = await tx.select().from(members).where(and(eq(members.groupId, groupId), eq(members.status, "joined")));
        const present = new Set(joined.flatMap((row) => (row.personaKey ? [row.personaKey] : [])));
        const wanted = personas.filter((persona) => !present.has(persona.key));
        if (wanted.length === 0) return ok([]);
        if (present.size + wanted.length > maxPersonas) throw new Rollback({ kind: "too_many", message: `A group can hold up to ${maxPersonas} test personas.` });
        if (joined.length + wanted.length > MAX_GROUP_MEMBERS) throw new Rollback({ kind: "full", message: `This group has no room for ${wanted.length} more people (the limit is ${MAX_GROUP_MEMBERS}).` });

        const added: Member[] = [];
        for (const persona of wanted) {
          const [row] = await tx
            .insert(members)
            .values({ groupId, displayName: persona.name, currency: group.baseCurrency, status: "joined", joinedAt: new Date(), personaKey: persona.key, inviteTokenHash: hashToken(generateToken()) })
            .returning();
          added.push(toMember(row));
        }
        return ok(added);
      });
    } catch (error) {
      if (error instanceof Rollback) return err(error.reason);
      return err({ kind: "unavailable", message: "The database could not be reached" });
    }
  }

  async addedKeys(groupId: string): Promise<readonly string[]> {
    const rows = await this.db.select({ key: members.personaKey }).from(members).where(and(eq(members.groupId, groupId), eq(members.status, "joined"), isNotNull(members.personaKey)));
    return rows.flatMap((row) => (row.key ? [row.key] : []));
  }

  async messagesSince(groupId: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(messages)
      .innerJoin(members, eq(messages.memberId, members.id))
      .where(and(eq(messages.groupId, groupId), isNotNull(members.personaKey), gte(messages.createdAt, since)));
    return row.total;
  }
}
