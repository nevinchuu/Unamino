/** What one person may make. Generous for a real group of friends, and far below what a script would try. */
export const PER_PERSON_GROUP_LIMITS = { perHour: 5, perDay: 15 } as const;

/**
 * How many groups the whole service will make: a backstop behind the per-person limit, for many people at once.
 * Making a group costs nothing, and each can ask the agent for plans.
 */
export const GROUP_CREATION_LIMITS = { perHour: 30, perDay: 200 } as const;

export const TOO_MANY_BY_YOU = "You've made several groups in a short time. Please try again in a little while.";
export const TOO_MANY_GROUPS = "Lots of groups are being made right now. Please try again in a little while.";

export interface GroupCounter {
  /** How many groups were made since `since`, anywhere. */
  createdSince(since: Date): Promise<number>;
  /** How many groups the person with this key made since `since`. */
  createdBySince(creatorKey: string, since: Date): Promise<number>;
}

/** "person_limit": this person has made too many. "site_limit": the whole service has. */
export type CreationVerdict = "allowed" | "person_limit" | "site_limit";

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Is there room to make another group? The person's own count is checked first, so one person making too many is told
 * so and never uses up the room that everyone else shares. A person whose address is not known (`creatorKey` null) is
 * only held to the whole service's limit. A count that cannot be read lets it through: the database being down fails
 * the creation itself, and it is not this check's place to turn a hiccup into a refusal.
 */
export async function groupCreationVerdict(counter: GroupCounter, now: Date, creatorKey: string | null): Promise<CreationVerdict> {
  const hourAgo = new Date(now.getTime() - HOUR_MS);
  const dayAgo = new Date(now.getTime() - DAY_MS);
  try {
    if (creatorKey !== null) {
      const [lastHour, lastDay] = await Promise.all([counter.createdBySince(creatorKey, hourAgo), counter.createdBySince(creatorKey, dayAgo)]);
      if (lastHour >= PER_PERSON_GROUP_LIMITS.perHour || lastDay >= PER_PERSON_GROUP_LIMITS.perDay) return "person_limit";
    }
    const [lastHour, lastDay] = await Promise.all([counter.createdSince(hourAgo), counter.createdSince(dayAgo)]);
    return lastHour < GROUP_CREATION_LIMITS.perHour && lastDay < GROUP_CREATION_LIMITS.perDay ? "allowed" : "site_limit";
  } catch {
    return "allowed";
  }
}
