import { err, ok, type Result } from "@/lib/result";
import type { OfferQuery, OfferSource } from "@/domain/offers/offer-source";
import type { Offer } from "@/domain/offers/schema";
import type { MemberShare } from "@/domain/split/types";
import { searchWithRetry, type SearchOptions } from "@/domain/trip/search";
import { applyPlanEvent, type ApplyEventError } from "./apply-event";
import { renewedDeadline } from "./deadline";
import type { PlanDetails, PlanDetailsStore, StoredPick } from "./details-store";
import { currentShares } from "./pricing";
import type { PlanRepository } from "./repository";
import type { PlanStatus } from "./statuses";
import type { PlanEffect, PlanEvent, PlanSnapshot } from "./types";

/** Offers are checked at most this often per plan, however many pages, polls and approvals ask. */
export const REFRESH_COOLDOWN_MS = 10_000;

/** Only a plan that people are still deciding on has offers worth checking. From `booking` on, the prices are the airline's and the hotel's. */
const REFRESHABLE_STATUSES: readonly PlanStatus[] = ["reviewing", "approving", "held"];

export interface RefreshDeps {
  readonly plans: PlanRepository;
  readonly details: PlanDetailsStore;
  readonly source: OfferSource;
  readonly cooldownMs?: number;
  readonly search?: SearchOptions;
}

export type RefreshOutcome =
  /** Nothing was checked: the plan is not open, or it was checked a moment ago. */
  | { readonly status: "skipped"; readonly reason: "not_open" | "cooldown" }
  /** Every pick is still on sale. Prices, deadline and approvals are brought up to date. */
  | {
      readonly status: "refreshed";
      readonly plan: PlanSnapshot;
      readonly shares: readonly MemberShare[];
      readonly deadlineExtended: boolean;
      readonly effects: readonly PlanEffect[];
    }
  /** A chosen listing is gone, so the plan has ended. `titles` names what could not be found. */
  | { readonly status: "unavailable"; readonly plan: PlanSnapshot; readonly titles: readonly string[]; readonly effects: readonly PlanEffect[] };

/**
 * "search_failed": the offers could not be looked up. The plan is unchanged and the check can be tried again.
 * "pricing_failed": the renewed offers cannot be priced (for example a different currency). The plan is unchanged.
 */
export type RefreshError = ApplyEventError | { readonly kind: "search_failed" | "pricing_failed"; readonly message: string };

type Searched = ReadonlyMap<string, readonly Offer[]>;

async function runSearches(source: OfferSource, details: PlanDetails, options: SearchOptions): Promise<Result<Searched, string>> {
  const searchIds = [...new Set(details.picks.flatMap((pick) => (pick.searchId && details.queries.has(pick.searchId) ? [pick.searchId] : [])))];
  const outcomes = await Promise.all(
    searchIds.map(async (searchId) => ({ searchId, result: await searchWithRetry(source, details.queries.get(searchId) as OfferQuery, options) })),
  );
  const searched = new Map<string, readonly Offer[]>();
  for (const { searchId, result } of outcomes) {
    if (!result.ok) return err(result.error.message);
    searched.set(searchId, result.value);
  }
  return ok(searched);
}

/**
 * The same listing, as the search returns it now. The offer id changes on every search, the listing id does not.
 * Hotels and flights carry a guest count, so a listing priced for a different party size is not the same offer.
 */
function findListing(pick: StoredPick, found: readonly Offer[]): Offer | null {
  const same = found.filter((offer) => offer.listingId === pick.offer.listingId && offer.kind === pick.offer.kind && offer.guests === pick.offer.guests);
  return same.reduce<Offer | null>((cheapest, offer) => (cheapest === null || offer.totalMinor < cheapest.totalMinor ? offer : cheapest), null);
}

interface Renewal {
  readonly pick: StoredPick;
  readonly offer: Offer;
}

function renewPicks(details: PlanDetails, searched: Searched): { readonly renewed: readonly Renewal[] } | { readonly missing: readonly string[] } {
  const renewed: Renewal[] = [];
  const missing: string[] = [];
  for (const pick of details.picks) {
    const offer = pick.searchId ? findListing(pick, searched.get(pick.searchId) ?? []) : null;
    if (offer) renewed.push({ pick, offer });
    else missing.push(pick.offer.title);
  }
  return missing.length > 0 ? { missing } : { renewed };
}

/**
 * Looks at the plan's offers again. If every chosen listing is still on sale, the new prices are put through the
 * state machine (so the 5% rule and the cap rule run) and the deadline moves to the new earliest expiry. If a listing
 * is gone, the plan ends. If the offers cannot be looked up at all, nothing changes.
 */
export async function refreshPlan(deps: RefreshDeps, planId: string, now: Date): Promise<Result<RefreshOutcome, RefreshError>> {
  const loaded = await deps.plans.load(planId);
  if (!loaded.ok) return err({ kind: "repository", error: loaded.error });
  if (!REFRESHABLE_STATUSES.includes(loaded.value.plan.status)) return ok({ status: "skipped", reason: "not_open" });

  const claim = await deps.details.claimRefresh(planId, now, deps.cooldownMs ?? REFRESH_COOLDOWN_MS);
  if (!claim.ok) return err({ kind: "repository", error: claim.error });
  if (!claim.value) return ok({ status: "skipped", reason: "cooldown" });

  const stored = await deps.details.load(planId);
  if (!stored.ok) return err({ kind: "repository", error: stored.error });
  const details = stored.value;

  const searched = await runSearches(deps.source, details, deps.search ?? {});
  if (!searched.ok) return err({ kind: "search_failed", message: searched.error });

  const effects: PlanEffect[] = [];
  let current = loaded.value.plan;
  const apply = async (event: PlanEvent): Promise<Result<void, ApplyEventError>> => {
    const applied = await applyPlanEvent(deps.plans, planId, event);
    if (!applied.ok) return err(applied.error);
    current = applied.value.plan;
    effects.push(...applied.value.effects);
    return ok(undefined);
  };

  const renewal = renewPicks(details, searched.value);
  if ("missing" in renewal) {
    const ended = await apply({ type: "offers_unavailable", at: now });
    return ended.ok ? ok({ status: "unavailable", plan: current, titles: renewal.missing, effects }) : err(ended.error);
  }

  // Priced before anything is saved, so offers that cannot be priced leave the plan exactly as it was.
  const shares = currentShares(details, renewal.renewed.map(({ pick, offer }) => ({ offer, memberIds: pick.memberIds })));
  if (!shares.ok) return err({ kind: "pricing_failed", message: shares.error.message });

  const saved = await deps.details.saveRenewal(planId, renewal.renewed.map(({ pick, offer }) => ({ pickId: pick.id, offer })));
  if (!saved.ok) return err({ kind: "repository", error: saved.error });

  // Extended first, so approvals do not lapse before the new prices are applied.
  const newDeadline = renewedDeadline({ offers: renewal.renewed.map(({ offer }) => offer), currentDeadlineAt: current.deadlineAt, hardDeadlineAt: current.hardDeadlineAt });
  let deadlineExtended = false;
  if (newDeadline) {
    const extended = await apply({ type: "deadline_extended", at: now, newDeadlineAt: newDeadline });
    // Someone else renewing at the same moment already moved it at least as far.
    const alreadyMoved = !extended.ok && extended.error.kind === "transition" && extended.error.error.code === "invalid_deadline";
    if (!extended.ok && !alreadyMoved) return err(extended.error);
    deadlineExtended = extended.ok;
  }

  for (const share of shares.value) {
    // The plan can change under this loop (a price rise sends everyone back), so each member is judged against its latest state.
    const member = current.members.find((candidate) => candidate.id === share.memberId);
    if (!member) continue;
    // Once approval opens, only a member who has approved has a cap to compare against. The others are priced when they approve.
    if (current.status !== "reviewing" && member.approval !== "approved") continue;
    const rechecked = await apply({ type: "price_rechecked", at: now, memberId: share.memberId, currentMinor: share.shareMinor });
    if (!rechecked.ok) return err(rechecked.error);
  }

  return ok({ status: "refreshed", plan: current, shares: shares.value, deadlineExtended, effects });
}
