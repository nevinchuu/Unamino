import { failureSummary, undoneSentence } from "@/domain/booking/announce";
import { unprotectedParts } from "@/domain/booking/order";
import type { Offer } from "@/domain/offers/schema";
import type { PaymentsMode } from "@/domain/payments/types";
import { tripKeptUntil } from "@/domain/retention/policy";
import { passportRequiredFor } from "@/domain/travellers/requirements";
import { clock, dateRange, dayAndTime, nightsBetween, shortDay } from "@/lib/plan-format";
import { listOf } from "@/lib/plan-card";
import { planReference } from "@/lib/plan-reference";
import { httpsUrlOrNull } from "@/lib/safe-url";
import type { CoverLine } from "@/domain/split/types";
import { currentShares } from "./pricing";
import type { ApprovalStatus, PlanAgreementStatus, PlanStatus } from "./statuses";
import type { PlanViewRaw, ViewIdea, ViewPick } from "./view-store";

/** The states in which people are still deciding, so the clock matters and the screen keeps checking. */
export const LIVE_PLAN_STATUSES: readonly PlanStatus[] = ["draft", "reviewing", "approving", "held"];

/**
 * The statuses in which the screen asks for fresh news every few seconds. It adds the two booking statuses to the live
 * ones: booking takes tens of seconds, and the screen should show it move rather than wait for the slow poll.
 */
export const FAST_POLL_STATUSES: readonly PlanStatus[] = [...LIVE_PLAN_STATUSES, "booking", "booked"];

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
  /** The airline's or hotel's own booking code, once the trip is booked and the supplier gave one. Null before that. */
  readonly bookingCode: string | null;
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

/** What an airline or hotel gave back for the trip, to quote at the desk. */
export interface ConfirmationDto {
  readonly kind: "flight" | "hotel";
  readonly title: string;
  readonly code: string;
}

/** One line of the booking progress. "active" is the one being worked on right now. */
export interface ProgressStepDto {
  readonly id: "holds" | "hotel" | "flight" | "charge";
  readonly label: string;
  readonly state: "done" | "active" | "waiting";
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
  /** The parts of their share, only when they pay in the plan's own currency so the parts add up to the total shown. Money a friend covers shows as a line too, below zero when it comes off. */
  readonly lines: readonly { readonly label: string; readonly minor: number }[];
  /** What they take part in, before any friend covers part of it, in the plan's currency. The most a friend can cover for them. Null if the offers cannot be priced. */
  readonly ownPartMinor: number | null;
  /** What they would have paid on the plan this one replaced, when there was one and they were in it. */
  readonly previousShareMinor: number | null;
  /** What the viewer is covering of this person, if anything. */
  readonly coveredByMe: { readonly whole: boolean; readonly percent: number | null; readonly amountMinor: number } | null;
}

/** A friend paying some or all of someone else's part. `amountMinor` is what is covered at today's prices, in the plan's currency. */
export interface CoverDto {
  readonly sponsorId: string;
  readonly sponsorName: string;
  readonly beneficiaryId: string;
  readonly beneficiaryName: string;
  readonly amountMinor: number;
  /** True when the whole of their part is covered, however the price moves. */
  readonly whole: boolean;
  /** Set when this is a percent of their part, which moves with the price. */
  readonly percent: number | null;
}

export interface PlanActions {
  readonly agree: boolean;
  readonly decline: boolean;
  readonly approve: boolean;
  readonly declineAmount: boolean;
  /** Ask Trippy to change the plan, which keeps it alive. Open while people are still deciding. */
  readonly requestChanges: boolean;
  /** Cover some or all of a friend's share. Open while people are still deciding, because the amounts are not final yet. */
  readonly cover: boolean;
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
  /** True when this person has approved an amount above nothing and their card still has to be added to the hold. */
  readonly cardNeeded: boolean;
  /** True when this person has approved and is not yet ready: they still owe a card, or (when a friend covers their whole share) their details. */
  readonly awaitingDetails: boolean;
  readonly details: DetailsDto;
  readonly actions: PlanActions;
}

/** Why a plan's booking failed, in the words the chat uses, for the plan screen. */
export interface FailureDto {
  /** Which part could not be booked and why. */
  readonly summary: string;
  /** What had already been booked and was cancelled again. Null when nothing had been. */
  readonly undone: string | null;
  /** The same plan may work if tried again. */
  readonly retryable: boolean;
}

export interface PlanViewDto {
  readonly id: string;
  readonly groupId: string;
  readonly title: string;
  readonly summary: string | null;
  readonly status: PlanStatus;
  readonly city: string | null;
  readonly dates: string | null;
  /** The trip's own dates, "YYYY-MM-DD", for a calendar file. */
  readonly tripDates: { readonly departDate: string | null; readonly returnDate: string | null };
  /** The day a booked trip's chat, plans and booking details are deleted, "YYYY-MM-DD". Null until the trip is booked, or when it has no dates. */
  readonly keptUntil: string | null;
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
  /** Said plainly while the plan is being decided, when two or more parts cannot be cancelled for free, so a later failed booking would leave the earlier ones paid for. Null when every part can be undone. */
  readonly refundWarning: string | null;
  readonly items: readonly PlanItemDto[];
  readonly ideas: readonly IdeaDto[];
  /** The suppliers own codes, once the trip is booked. Empty when none were given. */
  readonly confirmations: readonly ConfirmationDto[];
  /** The steps of booking the trip, while it is being booked. Empty at any other time. */
  readonly progress: readonly ProgressStepDto[];
  /** Why booking failed, for a plan that ended that way. Null for every other plan. */
  readonly failure: FailureDto | null;
  readonly people: readonly PersonDto[];
  /** Who is covering whom. Empty when everybody pays their own part. */
  readonly covers: readonly CoverDto[];
  readonly me: MeDto;
}

/** One cover as a line of the share: what the person pays for a friend, or what the friend pays for them (below zero). */
function coverLineOf(line: CoverLine, names: ReadonlyMap<string, string>): { readonly label: string; readonly minor: number } {
  const name = names.get(line.counterpartId) ?? "Someone";
  return line.direction === "covering" ? { label: `Covering ${name}`, minor: line.baseMinor } : { label: `${name} covers`, minor: -line.baseMinor };
}

const KIND_ORDER: Record<Offer["kind"], number> = { flight: 0, hotel: 1, activity: 2 };

function itemOf(pick: ViewPick, names: ReadonlyMap<string, string>, codes: ReadonlyMap<string, string>): PlanItemDto {
  const { offer } = pick;
  const base: ItemBase = {
    id: pick.id,
    title: offer.title,
    memberNames: pick.memberIds.map((id) => names.get(id) ?? "Someone"),
    reason: pick.reason,
    notes: Object.entries(pick.notes).map(([id, text]) => ({ name: names.get(id) ?? "Someone", text })),
    totalMinor: offer.totalMinor,
    currency: offer.currency,
    bookingCode: codes.get(pick.id) ?? null,
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
  return { id: idea.id, when: `${start} to ${clock(`${idea.date}T${idea.endTime}`) ?? idea.endTime}`, category: idea.category, name: idea.venue.name, address: idea.venue.address, mapsUrl: httpsUrlOrNull(idea.venue.mapsUrl), why: idea.why };
}

/** The supplier's code for each pick, once the trip is booked. A pick with several bookings keeps the first that has a code. */
function bookingCodesOf(raw: PlanViewRaw): Map<string, string> {
  const codes = new Map<string, string>();
  if (raw.status !== "booked" && raw.status !== "captured") return codes;
  for (const booking of raw.bookings) if (booking.confirmation && !codes.has(booking.pickId)) codes.set(booking.pickId, booking.confirmation);
  return codes;
}

function confirmationsOf(raw: PlanViewRaw): ConfirmationDto[] {
  return raw.bookings.flatMap((booking) => {
    const pick = raw.picks.find((candidate) => candidate.id === booking.pickId);
    if (!pick || !booking.confirmation || pick.offer.kind === "activity") return [];
    return [{ kind: pick.offer.kind, title: pick.offer.title, code: booking.confirmation }];
  });
}

/**
 * Where the booking has got to, for the lines under the banner while the trip is being booked. Hotels come first
 * because that is the order they are booked in. A step that has nothing to book (a hotel-only trip has no flight)
 * is left out. Once the plan is "booked" every booking is done, whether or not a supplier gave a record of it.
 */
function bookingProgressOf(raw: PlanViewRaw): ProgressStepDto[] {
  if (raw.status !== "held" && raw.status !== "booking" && raw.status !== "booked") return [];

  const bookedPickIds = new Set(raw.bookings.map((booking) => booking.pickId));
  const steps: { readonly id: ProgressStepDto["id"]; readonly doing: string; readonly done: string; readonly waiting: string; readonly finished: boolean }[] = [];
  for (const kind of ["hotel", "flight"] as const) {
    const picks = raw.picks.filter((pick) => pick.offer.kind === kind);
    if (picks.length === 0) continue;
    const word = kind === "hotel" ? "hotel" : "flight";
    steps.push({
      id: kind,
      doing: `Booking your ${word}…`,
      done: kind === "hotel" ? "Hotel booked" : "Flight booked",
      waiting: kind === "hotel" ? "Hotel" : "Flight",
      finished: raw.status === "booked" || picks.every((pick) => bookedPickIds.has(pick.id)),
    });
  }

  const supplierDone = steps.every((step) => step.finished);
  const working = raw.status !== "held";
  let activeTaken = false;
  const lines: ProgressStepDto[] = [{ id: "holds", label: "Every card hold is in place", state: "done" }];
  for (const step of steps) {
    if (step.finished) {
      lines.push({ id: step.id, label: step.done, state: "done" });
    } else if (working && !activeTaken) {
      activeTaken = true;
      lines.push({ id: step.id, label: step.doing, state: "active" });
    } else {
      lines.push({ id: step.id, label: step.waiting, state: "waiting" });
    }
  }
  lines.push(
    raw.status === "booked" && supplierDone
      ? { id: "charge", label: "Charging your cards…", state: "active" }
      : { id: "charge", label: "Charge your cards", state: "waiting" },
  );
  return lines;
}

/** The parts a failed later booking would leave paid for, in plain words. Null when everything booked before the last part can be cancelled for free. */
function refundWarningOf(picks: readonly ViewPick[], now: Date): string | null {
  const lost = unprotectedParts(picks, now).map((pick) => pick.offer.title);
  if (lost.length === 0) return null;
  const many = lost.length > 1;
  return `${listOf(lost)} can't be cancelled for free. If a booking made after ${many ? "them" : "it"} failed, ${many ? "they" : "it"} would not be refunded.`;
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
    /** What "now" is, for whether a hotel's free cancellation has run out. The real time when left out. */
    readonly now?: Date;
    /** Present when this server takes traveller details. `given` is whether the viewer has already given theirs. */
    readonly travellers?: { readonly given: boolean };
  },
): PlanViewDto {
  const names = new Map(raw.members.map((member) => [member.id, member.name]));
  const priced = currentShares(raw, raw.picks);
  const shares = new Map(priced.ok ? priced.value.map((share) => [share.memberId, share]) : []);
  // What each person would have paid before, from the plan this one replaced. Left out when that plan cannot be priced now.
  const before = raw.previous ? currentShares(raw.previous, raw.previous.picks) : null;
  const previousShares = new Map(before?.ok ? before.value.map((share) => [share.memberId, share.shareMinor]) : []);

  const covers: CoverDto[] = raw.covers.map((cover) => ({
    sponsorId: cover.sponsorId,
    sponsorName: names.get(cover.sponsorId) ?? "Someone",
    beneficiaryId: cover.beneficiaryId,
    beneficiaryName: names.get(cover.beneficiaryId) ?? "Someone",
    amountMinor: shares.get(cover.sponsorId)?.coverLines.find((line) => line.direction === "covering" && line.counterpartId === cover.beneficiaryId)?.baseMinor ?? 0,
    whole: cover.amountBaseMinor === null && (cover.sharePercent ?? null) === null,
    percent: cover.sharePercent ?? null,
  }));

  const people: PersonDto[] = raw.members.map((member) => {
    const share = shares.get(member.id);
    const mine = covers.find((cover) => cover.sponsorId === viewerId && cover.beneficiaryId === member.id);
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
      lines: share && share.currency === raw.baseCurrency ? [...share.lines.map((line) => ({ label: line.label, minor: line.baseMinor })), ...share.coverLines.map((line) => coverLineOf(line, names))] : [],
      ownPartMinor: share?.baseShareMinor ?? null,
      previousShareMinor: previousShares.get(member.id) ?? null,
      coveredByMe: mine ? { whole: mine.whole, percent: mine.percent, amountMinor: mine.amountMinor } : null,
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
    requestChanges: (reviewing || approving) && mine !== undefined,
    cover: (reviewing || approving) && mine !== undefined,
  };

  // The card and the details are asked for together, once the person has approved their amount. Someone whose whole share
  // a friend covers has nothing to hold, so they give their details and no card.
  const awaitingDetails = options.payments === "stripe" && approving && mine?.approval === "approved" && mine.holdPlaced === false;
  const cardNeeded = awaitingDetails && mine?.approvedMinor !== 0;
  const bookingCodes = bookingCodesOf(raw);

  return {
    id: raw.id,
    groupId: raw.groupId,
    title: raw.title,
    summary: raw.summary,
    status: raw.status,
    city: raw.trip.city,
    dates: dateRange(raw.trip.departDate, raw.trip.returnDate),
    tripDates: { departDate: raw.trip.departDate, returnDate: raw.trip.returnDate },
    keptUntil: raw.status === "booked" || raw.status === "captured" ? tripKeptUntil(raw.trip) : null,
    headcount: raw.headcount,
    deadlineAt: raw.deadlineAt.toISOString(),
    replacedBy: raw.replacedByPlanId,
    reference: raw.status === "captured" ? planReference(raw.id) : null,
    payments: options.payments,
    demoBooking: options.demoBooking ?? false,
    currency: raw.baseCurrency,
    pricesAvailable: priced.ok,
    refundWarning: LIVE_PLAN_STATUSES.includes(raw.status) ? refundWarningOf(raw.picks, options.now ?? new Date()) : null,
    items: [...raw.picks].sort((a, b) => KIND_ORDER[a.offer.kind] - KIND_ORDER[b.offer.kind]).map((pick) => itemOf(pick, names, bookingCodes)),
    ideas: raw.ideas.map(ideaOf),
    confirmations: raw.status === "booked" || raw.status === "captured" ? confirmationsOf(raw) : [],
    progress: bookingProgressOf(raw),
    failure: raw.failure ? { summary: failureSummary(raw.failure), undone: undoneSentence(raw.failure.undone), retryable: raw.failure.retryable } : null,
    people,
    covers,
    me: {
      id: viewerId,
      inPlan: mine !== undefined,
      agreement: mine?.agreement ?? null,
      approval: mine?.approval ?? null,
      shareMinor: mine?.shareMinor ?? null,
      approvedMinor: mine?.approvedMinor ?? null,
      cardNeeded,
      awaitingDetails,
      details: { needed: awaitingDetails && options.travellers !== undefined && !options.travellers.given, passportRequired: passportRequiredFor(raw.picks, viewerId) },
      actions,
    },
  };
}
