import { err, ok, type Result } from "@/lib/result";
import { allocateLineItem } from "./allocate";
import { convertMinor, rateBetween } from "./fx";
import type { FxRateTable, LineItem, MemberInput, MemberShare, ShareLine, SplitError } from "./types";

export interface ComputeSharesInput {
  readonly lineItems: readonly LineItem[];
  readonly members: readonly MemberInput[];
  readonly fx: FxRateTable;
}

/**
 * Works out what each member owes: the sum of their parts of every line item, in the base currency,
 * then converted once into their own currency. Converting the sum (not each line) keeps rounding to one step.
 */
export function computeMemberShares(input: ComputeSharesInput): Result<readonly MemberShare[], SplitError> {
  const { lineItems, members, fx } = input;
  if (members.length === 0) return err({ code: "no_members", message: "A split needs at least one member" });
  if (lineItems.length === 0) return err({ code: "no_line_items", message: "A split needs at least one cost" });
  if (new Set(members.map((member) => member.id)).size !== members.length) {
    return err({ code: "duplicate_member", message: "Member ids must be unique" });
  }

  const linesByMember = new Map<string, ShareLine[]>(members.map((member) => [member.id, []]));
  for (const item of lineItems) {
    const allocated = allocateLineItem(item);
    if (!allocated.ok) return allocated;
    for (const [memberId, baseMinor] of Object.entries(allocated.value)) {
      const lines = linesByMember.get(memberId);
      if (!lines) return err({ code: "unknown_member", message: `${item.label}: no member ${memberId}` });
      lines.push({ itemId: item.id, label: item.label, baseMinor });
    }
  }

  const shares: MemberShare[] = [];
  for (const member of members) {
    const lines = linesByMember.get(member.id) ?? [];
    if (lines.length === 0) {
      return err({ code: "member_has_no_share", message: `Member ${member.id} is not part of any cost` });
    }
    const baseShareMinor = lines.reduce((running, line) => running + line.baseMinor, 0);
    const converted = convertMinor(baseShareMinor, fx.baseCurrency, member.currency, fx);
    if (!converted.ok) return converted;
    shares.push({
      memberId: member.id,
      currency: member.currency,
      lines,
      baseShareMinor,
      shareMinor: converted.value,
      // convertMinor succeeded, so the rate exists
      fxRate: rateBetween(fx, fx.baseCurrency, member.currency) ?? 1,
      fxSource: fx.source,
    });
  }
  return ok(shares);
}

/** The plan total: the sum of every cost, base currency, minor units. */
export const totalOfLineItems = (lineItems: readonly LineItem[]): number =>
  lineItems.reduce((running, item) => running + item.totalMinor, 0);
