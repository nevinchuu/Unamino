/** How many groups the whole service will make. Making one costs nothing, and each can ask the agent for plans. */
export const GROUP_CREATION_LIMITS = { perHour: 30, perDay: 200 } as const;

export const TOO_MANY_GROUPS = "Lots of groups are being made right now. Please try again in a little while.";

export interface GroupCounter {
  /** How many groups were made since `since`, anywhere. */
  createdSince(since: Date): Promise<number>;
}

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Is there room to make another group? A count that cannot be read lets it through: the database being down fails
 * the creation itself, and it is not this check's place to turn a hiccup into a refusal.
 */
export async function groupCreationAllowed(counter: GroupCounter, now: Date): Promise<boolean> {
  try {
    const [lastHour, lastDay] = await Promise.all([counter.createdSince(new Date(now.getTime() - HOUR_MS)), counter.createdSince(new Date(now.getTime() - DAY_MS))]);
    return lastHour < GROUP_CREATION_LIMITS.perHour && lastDay < GROUP_CREATION_LIMITS.perDay;
  } catch {
    return true;
  }
}
