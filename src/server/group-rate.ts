/** What one person may make. Generous for a real group of friends, and far below what a script would try. */
export const PER_PERSON_GROUP_LIMITS = { perHour: 5, perDay: 15 } as const;

/**
 * How many groups the whole service will make: a backstop behind the per-person limit, for many people at once.
 * Making a group costs nothing, and each can ask the agent for plans.
 */
export const GROUP_CREATION_LIMITS = { perHour: 30, perDay: 200 } as const;

/**
 * The same, for the demo button only. Each tap makes a group with three simulated friends and starts a plan, which is
 * about twenty paid model calls, so it is held far lower than ordinary groups.
 */
export const PER_PERSON_DEMO_LIMITS = { perHour: 2, perDay: 6 } as const;
export const DEMO_START_LIMITS = { perHour: 10, perDay: 40 } as const;

export const TOO_MANY_BY_YOU = "You've made several groups in a short time. Please try again in a little while.";
export const TOO_MANY_GROUPS = "Lots of groups are being made right now. Please try again in a little while.";

export const TOO_MANY_DEMOS_BY_YOU = "You've started the demo a few times already. Open one of your demo groups from the Trips list, or try again in a little while.";
export const TOO_MANY_DEMOS = "The demo is busy right now. Please try again in a little while.";

export interface GroupCounter {
  /** How many groups were made since `since`, anywhere. Only those with one of these names when `names` is given. */
  createdSince(since: Date, names?: readonly string[]): Promise<number>;
  /** How many groups the person with this key made since `since`. Only those with one of these names when `names` is given. */
  createdBySince(creatorKey: string, since: Date, names?: readonly string[]): Promise<number>;
}

interface Limits {
  readonly perHour: number;
  readonly perDay: number;
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
  return verdictFor(counter, now, creatorKey, { person: PER_PERSON_GROUP_LIMITS, site: GROUP_CREATION_LIMITS });
}

/** Is there room to start another demo? The same rules, counting only the groups the demo button makes, against lower limits. */
export async function demoStartVerdict(counter: GroupCounter, now: Date, creatorKey: string | null, demoNames: readonly string[]): Promise<CreationVerdict> {
  return verdictFor(counter, now, creatorKey, { person: PER_PERSON_DEMO_LIMITS, site: DEMO_START_LIMITS, names: demoNames });
}

async function verdictFor(counter: GroupCounter, now: Date, creatorKey: string | null, rules: { readonly person: Limits; readonly site: Limits; readonly names?: readonly string[] }): Promise<CreationVerdict> {
  const hourAgo = new Date(now.getTime() - HOUR_MS);
  const dayAgo = new Date(now.getTime() - DAY_MS);
  try {
    if (creatorKey !== null) {
      const [lastHour, lastDay] = await Promise.all([counter.createdBySince(creatorKey, hourAgo, rules.names), counter.createdBySince(creatorKey, dayAgo, rules.names)]);
      if (lastHour >= rules.person.perHour || lastDay >= rules.person.perDay) return "person_limit";
    }
    const [lastHour, lastDay] = await Promise.all([counter.createdSince(hourAgo, rules.names), counter.createdSince(dayAgo, rules.names)]);
    return lastHour < rules.site.perHour && lastDay < rules.site.perDay ? "allowed" : "site_limit";
  } catch {
    return "allowed";
  }
}
