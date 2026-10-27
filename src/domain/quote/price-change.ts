import type { LineChange, MemberQuote, PriceChange, SeenQuote } from "./types";

/** What to remember when a member looks at their share, so the next look can show what moved. */
export const toSeenQuote = (quote: MemberQuote, seenAt: Date): SeenQuote => ({
  currency: quote.currency,
  shareMinor: quote.shareMinor,
  lines: quote.lines,
  seenAt: seenAt.toISOString(),
});

function changedLines(previous: SeenQuote, current: MemberQuote): readonly LineChange[] {
  const before = new Map(previous.lines.map((line) => [line.itemId, line]));
  const after = new Map(current.lines.map((line) => [line.itemId, line]));
  const changes: LineChange[] = [];

  for (const line of current.lines) {
    const old = before.get(line.itemId);
    if (old?.baseMinor !== line.baseMinor) {
      changes.push({ itemId: line.itemId, label: line.label, previousMinor: old?.baseMinor ?? null, currentMinor: line.baseMinor, deltaMinor: line.baseMinor - (old?.baseMinor ?? 0) });
    }
  }
  for (const line of previous.lines) {
    if (!after.has(line.itemId)) {
      changes.push({ itemId: line.itemId, label: line.label, previousMinor: line.baseMinor, currentMinor: null, deltaMinor: -line.baseMinor });
    }
  }
  return changes;
}

/** Compares what a member sees now with what they saw last time. Pure: the caller stores the snapshots. */
export function comparePrice(previous: SeenQuote | null, current: MemberQuote): PriceChange {
  if (previous === null) return { kind: "first_view" };
  if (previous.currency !== current.currency) return { kind: "currency_changed", from: previous.currency, to: current.currency };

  const lines = changedLines(previous, current);
  const shareDeltaMinor = current.shareMinor - previous.shareMinor;
  return lines.length === 0 && shareDeltaMinor === 0 ? { kind: "unchanged" } : { kind: "changed", shareDeltaMinor, lines };
}
