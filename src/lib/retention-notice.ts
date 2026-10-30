import { formatKeptUntil, RETENTION } from "@/domain/retention/policy";

/** What people are told about how long their trip stays in the app. `keptUntil` is "YYYY-MM-DD", or null when the trip has no dates. */
export function retentionNotice(keptUntil: string | null): string {
  const when = keptUntil === null ? `${RETENTION.daysAfterTrip} days after the trip ends` : formatKeptUntil(keptUntil);
  return `We keep this trip until ${when}, then delete the chat, the plans and the booking details. Save your trip pack to keep a copy.`;
}
