import { err, ok, type Result } from "@/lib/result";
import { isPositiveInteger } from "@/domain/money/currency";
import type { LineItem, SplitError } from "./types";

export type ItemAllocation = Readonly<Record<string, number>>;

/**
 * Divides one line item among its members. The parts always add up to the item's total exactly:
 * for an equal split, leftover minor units go one each to the first members in the list.
 */
export function allocateLineItem(item: LineItem): Result<ItemAllocation, SplitError> {
  if (!isPositiveInteger(item.totalMinor)) {
    return err({ code: "invalid_total", message: `${item.label}: total must be a positive integer in minor units` });
  }
  const { allocation } = item;
  return allocation.type === "equal"
    ? allocateEqually(item, allocation.memberIds)
    : validateCustom(item, allocation.amountsMinor);
}

function allocateEqually(item: LineItem, memberIds: readonly string[]): Result<ItemAllocation, SplitError> {
  if (memberIds.length === 0) {
    return err({ code: "no_members", message: `${item.label}: an item needs at least one member` });
  }
  if (new Set(memberIds).size !== memberIds.length) {
    return err({ code: "duplicate_member", message: `${item.label}: a member is listed twice` });
  }
  const base = Math.floor(item.totalMinor / memberIds.length);
  const leftover = item.totalMinor % memberIds.length;
  return ok(Object.fromEntries(memberIds.map((id, index) => [id, base + (index < leftover ? 1 : 0)])));
}

function validateCustom(item: LineItem, amounts: Readonly<Record<string, number>>): Result<ItemAllocation, SplitError> {
  const values = Object.values(amounts);
  if (values.length === 0) {
    return err({ code: "no_members", message: `${item.label}: an item needs at least one member` });
  }
  if (!values.every(isPositiveInteger)) {
    return err({ code: "invalid_share", message: `${item.label}: each amount must be a positive integer in minor units` });
  }
  const sum = values.reduce((running, amount) => running + amount, 0);
  if (sum !== item.totalMinor) {
    return err({ code: "shares_mismatch", message: `${item.label}: amounts add up to ${sum}, not ${item.totalMinor}` });
  }
  return ok(amounts);
}
