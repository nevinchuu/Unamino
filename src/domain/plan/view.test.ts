import { describe, expect, it } from "vitest";
import type { Cover } from "@/domain/split/types";
import type { ApprovalStatus, PlanAgreementStatus, PlanStatus } from "./statuses";
import { flight, hotel } from "./test-support";
import { buildPlanView, FAST_POLL_STATUSES, LIVE_PLAN_STATUSES } from "./view";
import type { PlanViewRaw, ViewIdea, ViewMember } from "./view-store";

const DEADLINE = new Date("2026-10-27T01:09:00.000Z");

const member = (id: string, name: string, overrides: Partial<ViewMember> = {}): ViewMember => ({ id, name, currency: "USD", planAgreement: "pending", approval: "pending", approvedMinor: null, chargedMinor: null, holdPlaced: false, ...overrides });

const IDEA: ViewIdea = {
  id: "i1", date: "2026-12-12", startTime: "10:00", endTime: "12:00", category: "market", why: "Ana and Ben both like markets",
  venue: { placeId: "p1", name: "Chatuchak Weekend Market", address: "Kamphaeng Phet 2 Rd, Bangkok", mapsUrl: "https://maps.example/p1", businessStatus: "operational", hours: null },
};

function raw(overrides: Partial<PlanViewRaw> = {}): PlanViewRaw {
  return {
    id: "plan-1",
    groupId: "group-1",
    title: "Bangkok weekend",
    summary: "A shared room and the evening flight",
    status: "reviewing",
    deadlineAt: DEADLINE,
    baseCurrency: "USD",
    fx: { baseCurrency: "USD", source: "test", ratesPerBase: { SGD: 1.35 } },
    headcount: 2,
    replacedByPlanId: null,
    trip: { city: "Bangkok", departDate: "2026-12-11", returnDate: "2026-12-13" },
    members: [member("ana", "Ana"), member("ben", "Ben")],
    picks: [
      { id: "pick-hotel", offer: hotel({ stars: 4, freeCancellationUntil: "2026-12-10T12:00:00Z", excludedCharges: [{ description: "City tax", amountMinor: 500, currency: "USD" }] }), memberIds: ["ana", "ben"], reason: "Fits the budget", notes: { ben: "own room" } },
      { id: "pick-flight", offer: flight(), memberIds: ["ana", "ben"], reason: "After 18:00 for Ana", notes: {} },
    ],
    ideas: [IDEA],
    covers: [],
    bookings: [],
    ...overrides,
  };
}

const view = (overrides: Partial<PlanViewRaw> = {}, viewer = "ana") => buildPlanView(raw(overrides), viewer, { payments: "none" });

describe("the plan as the screen shows it", () => {
  it("describes the trip, the status and the deadline", () => {
    expect(view()).toMatchObject({ id: "plan-1", groupId: "group-1", title: "Bangkok weekend", city: "Bangkok", dates: "Fri 11 Dec to Sun 13 Dec", headcount: 2, status: "reviewing", deadlineAt: "2026-10-27T01:09:00.000Z", currency: "USD", replacedBy: null });
  });

  it("carries the trip's own dates, and says when a booked trip's data will be deleted", () => {
    expect(view()).toMatchObject({ tripDates: { departDate: "2026-12-11", returnDate: "2026-12-13" }, keptUntil: null });
    expect(view({ status: "captured" }).keptUntil).toBe("2027-01-12");
    expect(view({ status: "booked" }).keptUntil).toBe("2027-01-12");
    expect(view({ status: "captured", trip: { city: "Bangkok", departDate: null, returnDate: null } }).keptUntil).toBeNull();
  });

  it("lists flights before hotels, with who each is for and why", () => {
    const { items } = view();
    expect(items.map((item) => item.kind)).toEqual(["flight", "hotel"]);
    expect(items[0]).toMatchObject({ title: "SIN to BKK", memberNames: ["Ana", "Ben"], reason: "After 18:00 for Ana", totalMinor: 20_000, currency: "USD" });
  });

  it("writes a flight's legs with the times on the clock at each airport", () => {
    const flightItem = view().items[0];
    if (flightItem.kind !== "flight") throw new Error("expected a flight");
    expect(flightItem.legs).toEqual([{ direction: "outbound", route: "SIN to BKK", departs: "Fri 11 Dec, 20:10", arrives: "Fri 11 Dec, 21:35", carrier: "Scoot" }]);
    expect(flightItem.refundable).toBe(false);
  });

  it("writes a hotel's stay, stars, free cancellation, extra charges and what was done for each person", () => {
    const hotelItem = view().items[1];
    if (hotelItem.kind !== "hotel") throw new Error("expected a hotel");
    expect(hotelItem).toMatchObject({ roomName: "Twin", stay: "Fri 11 Dec to Sun 13 Dec · 2 nights", stars: 4, freeCancellationUntil: "Thu 10 Dec", extraCharges: [{ description: "City tax", minor: 500, currency: "USD" }], notes: [{ name: "Ben", text: "own room" }] });
  });

  it("shows free-time ideas with the details Google confirmed", () => {
    expect(view().ideas).toEqual([{ id: "i1", when: "Sat 12 Dec, 10:00 to 12:00", category: "market", name: "Chatuchak Weekend Market", address: "Kamphaeng Phet 2 Rd, Bangkok", mapsUrl: "https://maps.example/p1", why: "Ana and Ben both like markets" }]);
  });

  it("says how money is handled, so the screen can show a card form, a demo note, or nothing", () => {
    for (const payments of ["stripe", "demo", "none"] as const) expect(buildPlanView(raw(), "ana", { payments }).payments).toBe(payments);
  });

  describe("whether a person still has to add their card", () => {
    const cardNeeded = (status: PlanStatus, overrides: Partial<ViewMember>, payments: "stripe" | "demo" | "none" = "stripe") =>
      buildPlanView(raw({ status, members: [member("ana", "Ana", { planAgreement: "agreed", approval: "approved", approvedMinor: 30_000, ...overrides }), member("ben", "Ben")] }), "ana", { payments }).me.cardNeeded;

    it("is true after approving, while the plan waits for holds, until the card is on the hold", () => {
      expect(cardNeeded("approving", {})).toBe(true);
      expect(cardNeeded("approving", { holdPlaced: true })).toBe(false);
    });

    it("is false before approving, once the plan has moved on, and when no real card is involved", () => {
      expect(cardNeeded("approving", { approval: "pending", approvedMinor: null })).toBe(false);
      expect(cardNeeded("reviewing", {})).toBe(false);
      expect(cardNeeded("held", {})).toBe(false);
      expect(cardNeeded("expired", {})).toBe(false);
      expect(cardNeeded("approving", {}, "demo")).toBe(false);
      expect(cardNeeded("approving", {}, "none")).toBe(false);
    });
  });
});

describe("who pays what", () => {
  it("gives each person their share and the parts it is made of", () => {
    const { people } = view();
    expect(people.map((p) => [p.name, p.shareMinor, p.isMe])).toEqual([["Ana", 30_000, true], ["Ben", 30_000, false]]);
    expect(people[0].lines).toEqual([{ label: "Riverside Hotel (Twin)", minor: 20_000 }, { label: "SIN to BKK", minor: 10_000 }]);
  });

  it("leaves out the parts for someone who pays in another currency, so they cannot disagree with the total", () => {
    const sgd = view({ members: [member("ana", "Ana", { currency: "SGD" }), member("ben", "Ben")] }).people[0];
    expect(sgd).toMatchObject({ shareMinor: 40_500, currency: "SGD", lines: [] });
  });

  it("shows no prices, and allows no agreeing, when the offers cannot be priced", () => {
    const unpriceable = view({ picks: [{ id: "p", offer: hotel({ currency: "SGD" }), memberIds: ["ana", "ben"], reason: "r", notes: {} }] });
    expect(unpriceable.pricesAvailable).toBe(false);
    expect(unpriceable.people.every((p) => p.shareMinor === null)).toBe(true);
    expect(unpriceable.me.actions.agree).toBe(false);
  });
});

describe("a friend covering someone's share", () => {
  const withCover = (cover: Cover, viewer = "ana", overrides: Partial<PlanViewRaw> = {}) => buildPlanView(raw({ covers: [cover], ...overrides }), viewer, { payments: "stripe", travellers: { given: false } });
  const anaCoversBen = { sponsorId: "ana", beneficiaryId: "ben", amountBaseMinor: 4_000 };

  it("moves the amount between the two cards and keeps the total", () => {
    const { people } = withCover(anaCoversBen);
    expect(people.map((p) => p.shareMinor)).toEqual([34_000, 26_000]);
    expect(people.reduce((sum, p) => sum + (p.shareMinor ?? 0), 0)).toBe(60_000);
  });

  it("shows the move as lines of the share, so the parts still add up", () => {
    const { people } = withCover(anaCoversBen);
    expect(people[0].lines.at(-1)).toEqual({ label: "Covering Ben", minor: 4_000 });
    expect(people[1].lines.at(-1)).toEqual({ label: "Ana covers", minor: -4_000 });
    for (const person of people) expect(person.lines.reduce((sum, line) => sum + line.minor, 0)).toBe(person.shareMinor);
  });

  it("lists who covers whom, and what the viewer covers of each person", () => {
    const dto = withCover({ sponsorId: "ana", beneficiaryId: "ben", amountBaseMinor: null });
    expect(dto.covers).toEqual([{ sponsorId: "ana", sponsorName: "Ana", beneficiaryId: "ben", beneficiaryName: "Ben", amountMinor: 30_000, whole: true, percent: null }]);
    expect(dto.people.find((p) => p.id === "ben")?.coveredByMe).toEqual({ whole: true, percent: null, amountMinor: 30_000 });
    expect(dto.people.find((p) => p.id === "ana")?.coveredByMe).toBeNull();
  });

  it("reports a percent cover with its percent, and not as the whole share", () => {
    const dto = withCover({ sponsorId: "ana", beneficiaryId: "ben", amountBaseMinor: null, sharePercent: 50 });
    expect(dto.covers).toEqual([{ sponsorId: "ana", sponsorName: "Ana", beneficiaryId: "ben", beneficiaryName: "Ben", amountMinor: 15_000, whole: false, percent: 50 }]);
    expect(dto.people.find((p) => p.id === "ben")?.coveredByMe).toEqual({ whole: false, percent: 50, amountMinor: 15_000 });
  });

  it("tells each person the most that can be covered for them: what they take part in, before any cover", () => {
    expect(withCover(anaCoversBen).people.map((p) => p.ownPartMinor)).toEqual([30_000, 30_000]);
  });

  it("allows covering while people are still deciding, and not after", () => {
    expect(withCover(anaCoversBen).me.actions.cover).toBe(true);
    expect(withCover(anaCoversBen, "ana", { status: "approving" }).me.actions.cover).toBe(true);
    expect(withCover(anaCoversBen, "ana", { status: "held" }).me.actions.cover).toBe(false);
    expect(withCover(anaCoversBen, "stranger").me.actions.cover).toBe(false);
  });

  describe("when the whole share is covered", () => {
    const covered = (overrides: Partial<ViewMember> = {}) =>
      withCover({ sponsorId: "ana", beneficiaryId: "ben", amountBaseMinor: null }, "ben", { status: "approving", members: [member("ana", "Ana"), member("ben", "Ben", { planAgreement: "agreed", approval: "approved", approvedMinor: 0, ...overrides })] });

    it("asks for the traveller details but no card", () => {
      const { me } = covered();
      expect(me).toMatchObject({ shareMinor: 0, cardNeeded: false, details: { needed: true } });
    });

    it("asks for nothing more once the details are in", () => {
      const dto = buildPlanView(raw({ status: "approving", covers: [{ sponsorId: "ana", beneficiaryId: "ben", amountBaseMinor: null }], members: [member("ana", "Ana"), member("ben", "Ben", { planAgreement: "agreed", approval: "approved", approvedMinor: 0, holdPlaced: true })] }), "ben", { payments: "stripe", travellers: { given: true } });
      expect(dto.me).toMatchObject({ cardNeeded: false, details: { needed: false } });
    });

    it("still asks the paying friend for a card", () => {
      const dto = buildPlanView(raw({ status: "approving", covers: [{ sponsorId: "ana", beneficiaryId: "ben", amountBaseMinor: null }], members: [member("ana", "Ana", { planAgreement: "agreed", approval: "approved", approvedMinor: 60_000 }), member("ben", "Ben")] }), "ana", { payments: "stripe", travellers: { given: false } });
      expect(dto.me).toMatchObject({ shareMinor: 60_000, cardNeeded: true });
    });
  });
});

describe("what a person may do", () => {
  const actionsFor = (status: PlanStatus, agreement: PlanAgreementStatus, approval: ApprovalStatus) =>
    view({ status, members: [member("ana", "Ana", { planAgreement: agreement, approval }), member("ben", "Ben")] }).me.actions;

  it("can agree or decline while the plan is being reviewed and they have not agreed", () => {
    expect(actionsFor("reviewing", "pending", "pending")).toEqual({ agree: true, decline: true, approve: false, declineAmount: false, requestChanges: true, cover: true });
  });

  it("can only decline, to change their mind, once they have agreed", () => {
    expect(actionsFor("reviewing", "agreed", "pending")).toEqual({ agree: false, decline: true, approve: false, declineAmount: false, requestChanges: true, cover: true });
  });

  it("can approve their amount, or decline, once everyone has agreed", () => {
    expect(actionsFor("approving", "agreed", "pending")).toEqual({ agree: false, decline: false, approve: true, declineAmount: true, requestChanges: true, cover: true });
  });

  it("can approve again after their price rose past their cap", () => {
    expect(actionsFor("approving", "agreed", "needs_reapproval").approve).toBe(true);
  });

  it("has nothing to approve once they have", () => {
    expect(actionsFor("approving", "agreed", "approved")).toEqual({ agree: false, decline: false, approve: false, declineAmount: true, requestChanges: true, cover: true });
  });

  it("can still back out while the holds are in, but not once booking has started or the plan has ended", () => {
    expect(actionsFor("held", "agreed", "approved").declineAmount).toBe(true);
    for (const status of ["booking", "booked", "captured", "expired"] as const) {
      expect(actionsFor(status, "agreed", "approved"), status).toEqual({ agree: false, decline: false, approve: false, declineAmount: false, requestChanges: false, cover: false });
    }
  });

  it("can ask for changes only while people are still deciding, not once the holds are in", () => {
    for (const status of ["reviewing", "approving"] as const) expect(actionsFor(status, "agreed", "approved").requestChanges, status).toBe(true);
    for (const status of ["held", "booking", "booked", "captured", "expired"] as const) expect(actionsFor(status, "agreed", "approved").requestChanges, status).toBe(false);
  });

  it("cannot act on a plan made before they joined, but can look at it", () => {
    const late = view({}, "newcomer");
    expect(late.me).toMatchObject({ id: "newcomer", inPlan: false, agreement: null, approval: null, shareMinor: null, actions: { agree: false, decline: false, approve: false, declineAmount: false, requestChanges: false, cover: false } });
    expect(late.people.some((p) => p.isMe)).toBe(false);
  });
});

describe("which states keep the screen checking", () => {
  it("are the ones where people are still deciding", () => {
    expect([...LIVE_PLAN_STATUSES].sort()).toEqual(["approving", "draft", "held", "reviewing"]);
  });
});

describe("traveller details on the plan screen", () => {
  const approved = (overrides: Partial<ViewMember> = {}) => [member("ana", "Ana", { planAgreement: "agreed", approval: "approved", approvedMinor: 30_000, ...overrides }), member("ben", "Ben")];
  const details = (options: { given?: boolean; payments?: "stripe" | "demo" | "none"; status?: PlanStatus; members?: ViewMember[] } = {}) =>
    buildPlanView(raw({ status: options.status ?? "approving", members: options.members ?? approved() }), "ana", {
      payments: options.payments ?? "stripe",
      travellers: { given: options.given ?? false },
    }).me.details;

  it("asks for details at the moment the card is asked for, and not before or after", () => {
    expect(details().needed).toBe(true);
    expect(details({ status: "reviewing" }).needed).toBe(false);
    expect(details({ members: approved({ approval: "pending" }) }).needed).toBe(false);
    expect(details({ members: approved({ holdPlaced: true }) }).needed).toBe(false);
  });

  it("stops asking once they are given", () => {
    expect(details({ given: true }).needed).toBe(false);
  });

  it("does not ask when this server takes no details, or when no real card is involved", () => {
    expect(buildPlanView(raw({ status: "approving", members: approved() }), "ana", { payments: "stripe" }).me.details.needed).toBe(false);
    expect(details({ payments: "demo" }).needed).toBe(false);
  });

  it("asks for a passport only from people on a flight", () => {
    expect(details().passportRequired).toBe(true);
    const asked = { payments: "stripe", travellers: { given: false } } as const;
    const hotelOnly = raw({ status: "approving", members: approved(), picks: [{ id: "h", offer: hotel(), memberIds: ["ana", "ben"], reason: "r", notes: {} }] });
    expect(buildPlanView(hotelOnly, "ana", asked).me.details).toEqual({ needed: true, passportRequired: false });
    const benOnly = raw({ status: "approving", members: approved(), picks: [{ id: "f", offer: flight(), memberIds: ["ben"], reason: "r", notes: {} }] });
    expect(buildPlanView(benOnly, "ana", asked).me.details.passportRequired).toBe(false);
  });
});

describe("a paid trip", () => {
  const paid = (overrides: Partial<PlanViewRaw> = {}) =>
    raw({ status: "captured", members: [member("ana", "Ana", { planAgreement: "agreed", approval: "approved", approvedMinor: 30_000, chargedMinor: 26_500, holdPlaced: true }), member("ben", "Ben", { planAgreement: "agreed", approval: "approved", approvedMinor: 30_000, chargedMinor: 27_000, holdPlaced: true })], ...overrides });

  it("carries a reference made from the plan, and what each person was really charged", () => {
    const shown = buildPlanView(paid(), "ana", { payments: "stripe" });
    expect(shown.reference).toBe("UN-A10000");
    expect(shown.people.map((person) => person.chargedMinor)).toEqual([26_500, 27_000]);
    expect(shown.me.approvedMinor).toBe(30_000);
  });

  it("has no reference, and nothing charged, before the trip is paid for", () => {
    for (const status of ["reviewing", "approving", "held", "booking", "booked", "expired"] as const) {
      expect(buildPlanView(raw({ status }), "ana", { payments: "stripe" }).reference, status).toBeNull();
    }
    expect(view().people.every((person) => person.chargedMinor === null)).toBe(true);
  });

  describe("the suppliers' booking codes", () => {
    const bookings = [{ pickId: "pick-flight", confirmation: "FL123" }, { pickId: "pick-hotel", confirmation: "HC9" }, { pickId: "pick-hotel", confirmation: null }];

    it("shows the code each supplier gave once the trip is booked, with the name of what was booked", () => {
      const dto = view({ status: "captured", bookings });
      expect(dto.confirmations).toEqual([
        { kind: "flight", title: "SIN to BKK", code: "FL123" },
        { kind: "hotel", title: "Riverside Hotel", code: "HC9" },
      ]);
    });

    it("puts each code on its own flight or hotel too, so it can be read where the booking is shown", () => {
      const dto = view({ status: "captured", bookings });
      expect(dto.items.map((item) => [item.kind, item.bookingCode])).toEqual([["flight", "FL123"], ["hotel", "HC9"]]);
    });

    it("leaves a booking code off an item until the trip is booked, and when the supplier gave none", () => {
      expect(view({ status: "booking", bookings }).items.map((item) => item.bookingCode)).toEqual([null, null]);
      expect(view({ status: "captured", bookings: [{ pickId: "pick-hotel", confirmation: null }] }).items.map((item) => item.bookingCode)).toEqual([null, null]);
    });

    it("shows nothing before the trip is booked, even if a booking exists", () => {
      expect(view({ status: "booking", bookings }).confirmations).toEqual([]);
    });

    it("leaves out a booking whose pick is gone", () => {
      expect(view({ status: "captured", bookings: [{ pickId: "nope", confirmation: "X" }] }).confirmations).toEqual([]);
    });
  });

  describe("the booking progress", () => {
    const hotelOnly = { picks: [raw().picks[0]] };
    const states = (dto: ReturnType<typeof view>) => dto.progress.map((step) => `${step.id}:${step.state}`);

    it("shows nothing outside the time the trip is being booked", () => {
      for (const status of ["draft", "reviewing", "approving", "captured", "expired"] as const) expect(view({ status }).progress).toEqual([]);
    });

    it("says the holds are in, and that booking is next, once everyone is in but booking has not started", () => {
      expect(states(view({ status: "held" }))).toEqual(["holds:done", "hotel:waiting", "flight:waiting", "charge:waiting"]);
    });

    it("works on the hotel first, as the hotel is booked first, and names what it is doing", () => {
      const dto = view({ status: "booking" });
      expect(states(dto)).toEqual(["holds:done", "hotel:active", "flight:waiting", "charge:waiting"]);
      expect(dto.progress[1].label).toBe("Booking your hotel…");
    });

    it("moves on to the flight when the hotel has a booking, and shows the hotel as done", () => {
      const dto = view({ status: "booking", bookings: [{ pickId: "pick-hotel", confirmation: "HC1" }] });
      expect(states(dto)).toEqual(["holds:done", "hotel:done", "flight:active", "charge:waiting"]);
      expect(dto.progress.map((step) => step.label)).toEqual(["Every card hold is in place", "Hotel booked", "Booking your flight…", "Charge your cards"]);
    });

    it("leaves out the flight for a trip with only a hotel", () => {
      expect(states(view({ status: "booking", ...hotelOnly }))).toEqual(["holds:done", "hotel:active", "charge:waiting"]);
    });

    it("is charging the cards once the plan is booked, with every booking shown as done even without a record of it", () => {
      expect(states(view({ status: "booked" }))).toEqual(["holds:done", "hotel:done", "flight:done", "charge:active"]);
    });

    it("counts a booking only for the pick it belongs to", () => {
      const dto = view({ status: "booking", bookings: [{ pickId: "pick-flight", confirmation: null }] });
      expect(states(dto)).toEqual(["holds:done", "hotel:active", "flight:done", "charge:waiting"]);
    });
  });

  it("asks for fresh news quickly while live and while booking, but only counts prices down while live", () => {
    expect([...FAST_POLL_STATUSES].sort()).toEqual(["approving", "booked", "booking", "draft", "held", "reviewing"]);
    expect(LIVE_PLAN_STATUSES.includes("booking")).toBe(false);
  });

  it("shows a place's map link only when it is a plain https address", () => {
    const idea = (mapsUrl: string | null) => ({ ...IDEA, venue: { ...IDEA.venue, mapsUrl } });
    expect(view({ ideas: [idea("https://maps.google.com/?cid=1")] }).ideas[0].mapsUrl).toBe("https://maps.google.com/?cid=1");
    expect(view({ ideas: [idea("javascript:alert(1)")] }).ideas[0].mapsUrl).toBeNull();
  });
});
