import type { Offer } from "@/domain/offers/schema";
import type { PaymentsMode } from "@/domain/payments/types";
import { passportRequiredFor } from "@/domain/travellers/requirements";
import { clock, dateRange, dayAndTime, nightsBetween, shortDay } from "@/lib/plan-format";
import { planReference } from "@/lib/plan-reference";
import { currentShares } from "./pricing";
import type { ApprovalStatus, PlanAgreementStatus, PlanStatus } from "./statuses";
import type { PlanViewRaw, ViewIdea, ViewPick } from "./view-store";

/** The states in which people are still deciding, so the clock matters and the screen keeps checking. */
export const LIVE_PLAN_STATUSES: readonly PlanStatus[] = ["draft", "reviewing", "approving", "held"];

interface ItemBase {
  readonly id: string;
  readonly title: string;
  /** Who this is for, by name. */
  readonly memberNames: readonly string[];
  readonly reason: string;
  /** What was done for or about each person, such as "after 18:00". */
  readonly notes: readonly { readonly name: string; readonly text: string }[];
  /** The price of this item for everyone it covers, in `currency`. */
  readonly totalMinor: number;
  readonly currency: string;
}

export type PlanItemDto =
  | (ItemBase & {
      readonly kind: "flight";
      readonly legs: readonly { readonly direction: "outbound" | "inbound"; readonly route: string; readonly departs: string; readonly arrives: string; readonly carrier: string }[];
      readonly refundable: boolean;
    })
  | (ItemBase & {
      readonly kind: "hotel";
      readonly roomName: string;
      /** "Fri 11 Dec to Sun 13 Dec · 2 nights". */
      readonly stay: string;
      readonly stars: number | null;
      readonly freeCancellationUntil: string | null;
      readonly extraCharges: readonly { readonly description: string; readonly minor: number; readonly currency: string }[];
    })
  | (ItemBase & { readonly kind: "activity"; readonly when: string; readonly durationMinutes: number });

export interface IdeaDto {
  readonly id: string;
  readonly when: string;
  readonly category: string;
  readonly name: string;
  readonly address: string | null;
  readonly mapsUrl: string | null;
  readonly why: string;
}

export interface PersonDto {
  readonly id: string;
  readonly name: string;
  readonly isMe: boolean;
  readonly agreement: PlanAgreementStatus;
  readonly approval: ApprovalStatus;
  readonly holdPlaced: boolean;
  /** What they owe at today's prices, in their own currency. Null if the offers cannot be priced right now. */
  readonly shareMinor: number | null;
  readonly currency: string;
  readonly approvedMinor: number | null;
  /** What they were really charged. Null until the trip is paid for. */
  readonly chargedMinor: number | null;
  /** The parts of their share, only when they pay in the plan's own currency so the parts add up to the total shown. */
  readonly lines: readonly { readonly label: string; readonly minor: number }[];
}

export interface PlanActions {
  readonly agree: boolean;
  readonly decline: boolean;
  readonly approve: boolean;
  readonly declineAmount: boolean;
}

/** What this person still owes the booking in the way of personal details. */
export interface DetailsDto {
  /** True when their traveller details are asked for now and not yet given. */
  readonly needed: boolean;
  /** True when they take part in a flight, which needs a passport. */
  readonly passportRequired: boolean;
}

export interface MeDto {
  readonly id: string;
  /** False for someone who joined the group after this plan was made. They can look but not act. */
  readonly inPlan: boolean;
  readonly agreement: PlanAgreementStatus | null;
  readonly approval: ApprovalStatus | null;
  readonly shareMinor: number | null;
  readonly approvedMinor: number | null;
  /** True when this person has approved and their card still has to be added to the hold. */
  readonly cardNeeded: boolean;
  readonly details: DetailsDto;
  readonly actions: PlanActions;
}

export interface PlanViewDto {
  readonly id: string;
  readonly groupId: string;
  readonly title: string;
  readonly summary: string | null;
  readonly status: PlanStatus;
  readonly city: string | null;
  readonly dates: string | null;
  readonly headcount: number;
  /** ISO time. Moves later when the offers are renewed. */
  readonly deadlineAt: string;
  readonly replacedBy: string | null;
  /** The code the group can quote for a paid trip. Null until the trip is paid for. */
  readonly reference: string | null;
  /** How money is handled, so the screen shows a card form, a demo note, or nothing. */
  readonly payments: PaymentsMode;
  /** True when booking is only pretended, so the screen says nothing real was booked. */
  readonly demoBooking: boolean;
  readonly currency: string;
  readonly pricesAvailable: boolean;
  readonly items: readonly PlanItemDto[];
  readonly ideas: readonly IdeaDto[];
  readonly people: readonly PersonDto[];
  readonly me: MeDto;
}

const KIND_ORDER: Record<Offer["kind"], number> = { flight: 0, hotel: 1, activity: 2 };

function itemOf(pick: ViewPick, names: ReadonlyMap<string, string>): PlanItemDto {
  const { offer } = pick;
  const base: ItemBase = {
    id: pick.id,
    title: offer.title,
    memberNames: pick.memberIds.map((id) => names.get(id) ?? "Someone"),
    reason: pick.reason,
    notes: Object.entries(pick.notes).map(([id, text]) => ({ name: names.get(id) ?? "Someone", text })),
    totalMinor: offer.totalMinor,
    currency: offer.currency,
  };

  switch (offer.kind) {
    case "flight":
      return {
        ...base,
        kind: "flight",
        refundable: offer.refundable,
        legs: offer.legs.map((leg) => ({ direction: leg.direction, route: `${leg.origin} to ${leg.destination}`, departs: dayAndTime(leg.departAt), arrives: dayAndTime(leg.arriveAt), carrier: leg.carrier })),
      };
    case "hotel": {
      const nights = nightsBetween(offer.checkIn, offer.checkOut);
      return {
        ...base,
        kind: "hotel",
        roomName: offer.roomName,
        stay: `${dateRange(offer.checkIn, offer.checkOut) ?? ""}${nights ? ` · ${nights} ${nights === 1 ? "night" : "nights"}` : ""}`,
        stars: offer.stars ?? null,
        // The cut-off is an instant; its calendar day is what a person reads.
        freeCancellationUntil: offer.freeCancellationUntil ? shortDay(offer.freeCancellationUntil) : null,
        extraCharges: (offer.excludedCharges ?? []).map((charge) => ({ description: charge.description, minor: charge.amountMinor, currency: charge.currency })),
      };
    }
    case "activity":
      return { ...base, kind: "activity", when: dayAndTime(`${offer.date}${offer.startTime ? `T${offer.startTime}` : ""}`), durationMinutes: offer.durationMinutes };
  }
}

function ideaOf(idea: ViewIdea): IdeaDto {
  const start = dayAndTime(`${idea.date}T${idea.startTime}`);
  return { id: idea.id, when: `${start} to ${clock(`${idea.date}T${idea.endTime}`) ?? idea.endTime}`, category: idea.category, name: idea.venue.name, address: idea.venue.address, mapsUrl: idea.venue.mapsUrl, why: idea.why };
}

/**
 * What one person sees of a plan, worked out from what is stored. Prices are today's, from the stored offers, and
 * what the person may do is decided here from the plan's state and their own, so the screen never has to guess.
 */
export function buildPlanView(
  raw: PlanViewRaw,
  viewerId: string,
  options: {
    readonly payments: PaymentsMode;
    readonly demoBooking?: boolean;
    /** Present when this server takes traveller details. `given` is whether the viewer has already given theirs. */
    readonly travellers?: { readonly given: boolean };
  },
): PlanViewDto {
  const names = new Map(raw.members.map((member) => [member.id, member.name]));
  const priced = currentShares(raw, raw.picks);
  const shares = new Map(priced.ok ? priced.value.map((share) => [share.memberId, share]) : []);

  const people: PersonDto[] = raw.members.map((member) => {
    const share = shares.get(member.id);
    return {
      id: member.id,
      name: member.name,
      isMe: member.id === viewerId,
      agreement: member.planAgreement,
      approval: member.approval,
      holdPlaced: member.holdPlaced,
      shareMinor: share?.shareMinor ?? null,
      currency: member.currency,
      approvedMinor: member.approvedMinor,
      chargedMinor: member.chargedMinor,
      lines: share && share.currency === raw.baseCurrency ? share.lines.map((line) => ({ label: line.label, minor: line.baseMinor })) : [],
    };
  });

  const mine = people.find((person) => person.isMe);
  const reviewing = raw.status === "reviewing";
  const approving = raw.status === "approving";
  const canPrice = mine !== undefined && mine.shareMinor !== null;
  const actions: PlanActions = {
    agree: reviewing && mine?.agreement === "pending" && canPrice,
    decline: reviewing && mine !== undefined,
    approve: approving && (mine?.approval === "pending" || mine?.approval === "needs_reapproval") && canPrice,
    declineAmount: (approving || raw.status === "held") && mine !== undefined,
  };

  // The card and the details are asked for together, once the person has approved their amount.
  const cardNeeded = options.payments === "stripe" && approving && mine?.approval === "approved" && mine.holdPlaced === false;

  return {
    id: raw.id,
    groupId: raw.groupId,
    title: raw.title,
    summary: raw.summary,
    status: raw.status,
    city: raw.trip.city,
    dates: dateRange(raw.trip.departDate, raw.trip.returnDate),
    headcount: raw.headcount,
    deadlineAt: raw.deadlineAt.toISOString(),
    replacedBy: raw.replacedByPlanId,
    reference: raw.status === "captured" ? planReference(raw.id) : null,
    payments: options.payments,
    demoBooking: options.demoBooking ?? false,
    currency: raw.baseCurrency,
    pricesAvailable: priced.ok,
    items: [...raw.picks].sort((a, b) => KIND_ORDER[a.offer.kind] - KIND_ORDER[b.offer.kind]).map((pick) => itemOf(pick, names)),
    ideas: raw.ideas.map(ideaOf),
    people,
    me: {
      id: viewerId,
      inPlan: mine !== undefined,
      agreement: mine?.agreement ?? null,
      approval: mine?.approval ?? null,
      shareMinor: mine?.shareMinor ?? null,
      approvedMinor: mine?.approvedMinor ?? null,
      cardNeeded,
      details: { needed: cardNeeded && options.travellers !== undefined && !options.travellers.given, passportRequired: passportRequiredFor(raw.picks, viewerId) },
      actions,
    },
  };
}
