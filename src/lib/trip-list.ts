import { snippet } from "./chat-format";
import type { CardPerson, CardPlan } from "./plan-card";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** How long ago, in the shortest words a list can carry: "now", "5m", "3h", "2d", "1w". */
export function relativeTime(at: Date, now: Date): string {
  const ago = now.getTime() - at.getTime();
  if (ago < MINUTE_MS) return "now";
  if (ago < HOUR_MS) return `${Math.floor(ago / MINUTE_MS)}m`;
  if (ago < DAY_MS) return `${Math.floor(ago / HOUR_MS)}h`;
  if (ago < WEEK_MS) return `${Math.floor(ago / DAY_MS)}d`;
  return `${Math.floor(ago / WEEK_MS)}w`;
}

export interface PreviewSource {
  readonly kind: "human" | "agent" | "system";
  /** Who wrote it. Null for a system line. */
  readonly senderName: string | null;
  /** The person looking at the list wrote it. */
  readonly mine: boolean;
  readonly body: string;
}

/** The last message as one line for a list: "Ana: see you at 8", with "You" for the viewer's own and system lines left unsigned. */
export function previewOf({ kind, senderName, mine, body }: PreviewSource): string {
  const text = snippet(body, 90);
  if (kind === "system") return text;
  return `${mine ? "You" : (senderName ?? "Someone")}: ${text}`;
}

export type TripTone = "success" | "pending" | "solid" | "neutral";

export interface TripStatus {
  readonly label: string;
  readonly tone: TripTone;
}

/** The plan the group is working on or finished with: the newest one that no later plan took over from. */
export function latestPlan<T extends Pick<CardPlan, "replacedById">>(plans: readonly T[]): T | null {
  return [...plans].reverse().find((plan) => plan.replacedById === null) ?? null;
}

/** The chip on a trip's card. Null when the group has no plan yet. */
export function tripStatus(plan: CardPlan | null, people: readonly CardPerson[]): TripStatus | null {
  if (!plan) return null;
  switch (plan.status) {
    case "draft":
    case "reviewing":
      return { label: `${plan.agreedCount} of ${plan.headcount} agreed`, tone: "success" };
    case "approving":
      return { label: `${people.filter((person) => person.held).length} of ${plan.headcount} approved`, tone: "pending" };
    case "held":
      return { label: "Everyone has approved", tone: "pending" };
    case "booking":
      return { label: "Booking now", tone: "pending" };
    case "booked":
      return { label: "Taking payment", tone: "pending" };
    case "captured":
      return { label: "Booked", tone: "solid" };
    case "expired":
      return { label: "Plan ended", tone: "neutral" };
  }
}
