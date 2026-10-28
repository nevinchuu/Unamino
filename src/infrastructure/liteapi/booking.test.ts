import { describe, expect, it } from "vitest";
import { flight, hotel } from "@/domain/plan/test-support";
import { SAMPLE_TRAVELLER } from "@/domain/booking/test-support";
import { LiteApiBookingHttp } from "./booking-http";
import { clientReferenceFor, LiteApiHotelSupplier } from "./hotel-booking";
import { LiteApiFlightSupplier } from "./flight-booking";

const API_KEY = "sand_test_key_that_must_never_leak";
const lead = { memberId: "ana", details: SAMPLE_TRAVELLER };

interface Call {
  readonly method: string;
  readonly url: string;
  readonly body: Record<string, unknown> | null;
}

type Answer = { readonly status?: number; readonly body: unknown } | "network_down";

/** A fake `fetch` that answers each call by the end of its path, and records what was sent. */
function fakeLiteApi(answers: Readonly<Record<string, Answer>>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ method: init.method ?? "GET", url, body: typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null });
    const key = Object.keys(answers).find((suffix) => url.endsWith(suffix));
    const answer = key ? answers[key] : { status: 500, body: { error: { code: 1 } } };
    if (answer === "network_down") throw new Error("offline");
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as unknown as typeof fetch;
  return { http: new LiteApiBookingHttp({ apiKey: API_KEY, fetchImpl }), calls };
}

const request = (overrides: Partial<Parameters<LiteApiHotelSupplier["book"]>[0]> = {}) => ({ offer: hotel(), reference: "plan-1:pick-hotel", lead, maxTotalMinor: 40_000, ...overrides });

const hotelPrebook = (price = 400, extra: Record<string, unknown> = {}) => ({ body: { data: { prebookId: "pb-1", price, currency: "USD", ...extra } } });
const hotelBooked = (status = "CONFIRMED") => ({ body: { data: { bookingId: "hb-1", status, hotelConfirmationCode: "HC1" }, sandbox: true } });

describe("LiteApiHotelSupplier", () => {
  it("prebooks, then books with one lead guest, the full phone number and a short client reference", async () => {
    const { http, calls } = fakeLiteApi({ "/rates/prebook": hotelPrebook(), "/rates/book": hotelBooked() });
    const result = await new LiteApiHotelSupplier(http).book(request());

    expect(result).toEqual({ ok: true, value: { bookingId: "hb-1", confirmation: "HC1" } });
    expect(calls.map((call) => call.url)).toEqual(["https://book.liteapi.travel/v3.0/rates/prebook", "https://book.liteapi.travel/v3.0/rates/book"]);
    expect(calls[0].body).toEqual({ offerId: "hotel-offer-1", usePaymentSdk: false });
    expect(calls[1].body).toMatchObject({
      prebookId: "pb-1",
      payment: { method: "ACC_CREDIT_CARD" },
      holder: { firstName: "Daniel", phone: "+6591234567" },
      guests: [{ occupancyNumber: 1, firstName: "Daniel", lastName: "Tan" }],
    });
    expect(String(calls[1].body?.clientReference)).toBe(clientReferenceFor("plan-1:pick-hotel"));
    expect(clientReferenceFor("plan-1:pick-hotel")).toHaveLength(32);
  });

  it("books nothing when the room now costs more than the offer said", async () => {
    const { http, calls } = fakeLiteApi({ "/rates/prebook": hotelPrebook(400.01), "/rates/book": hotelBooked() });
    const result = await new LiteApiHotelSupplier(http).book(request());

    expect(result).toMatchObject({ ok: false, error: { code: "price_changed" } });
    expect(calls).toHaveLength(1);
  });

  it("accepts a lower price", async () => {
    const { http } = fakeLiteApi({ "/rates/prebook": hotelPrebook(380), "/rates/book": hotelBooked() });
    expect((await new LiteApiHotelSupplier(http).book(request())).ok).toBe(true);
  });

  it("refuses a room whose meal plan changed", async () => {
    const { http, calls } = fakeLiteApi({ "/rates/prebook": hotelPrebook(400, { boardChanged: true }), "/rates/book": hotelBooked() });
    expect(await new LiteApiHotelSupplier(http).book(request())).toMatchObject({ ok: false, error: { code: "rejected" } });
    expect(calls).toHaveLength(1);
  });

  it("says a room is unavailable when the offer has expired", async () => {
    const { http } = fakeLiteApi({ "/rates/prebook": { status: 408, body: { error: { code: 4040, message: "outdated offerId" } } } });
    expect(await new LiteApiHotelSupplier(http).book(request())).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });

  it("cancels a booking that exists but was not confirmed", async () => {
    const { http, calls } = fakeLiteApi({ "/rates/prebook": hotelPrebook(), "/rates/book": hotelBooked("PENDING"), "/bookings/hb-1": { body: { data: { status: "CANCELLED" } } } });
    const result = await new LiteApiHotelSupplier(http).book(request());

    expect(result).toMatchObject({ ok: false, error: { code: "rejected" } });
    expect(calls.at(-1)).toMatchObject({ method: "PUT", url: "https://book.liteapi.travel/v3.0/bookings/hb-1" });
  });

  it("treats a lost connection as temporary, and never puts the key in the error", async () => {
    const { http } = fakeLiteApi({ "/rates/prebook": "network_down" });
    const result = await new LiteApiHotelSupplier(http).book(request());

    expect(result).toMatchObject({ ok: false, error: { code: "temporary" } });
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });

  it("cancels with a PUT, and counts cancelled-with-charges as cancelled", async () => {
    const { http, calls } = fakeLiteApi({ "/bookings/hb-1": { body: { data: { status: "CANCELLED_WITH_CHARGES" } } } });
    expect(await new LiteApiHotelSupplier(http).cancel("hb-1")).toEqual({ ok: true, value: "cancelled" });
    expect(calls[0].method).toBe("PUT");
  });
});

const flightRequest = (overrides: Partial<Parameters<LiteApiFlightSupplier["book"]>[0]> = {}) => ({
  offer: flight(),
  reference: "plan-1:pick-flight",
  passengers: [lead, { memberId: "ben", details: { ...SAMPLE_TRAVELLER, firstName: "Ben" } }],
  maxTotalMinor: 20_000,
  ...overrides,
});

const verifyAnswer = (total = 200, changes: unknown = null) => ({ body: { data: [{ journey: { pricing: { display: { total, currency: "USD" } } }, changes }] } });
const prebookAnswer = (price = 200) => ({ body: { data: [{ prebookId: "fp-1", price, currency: "USD" }] } });
const bookedAnswer = (status = "PENDING_CONFIRMATION") => ({ status: 201, body: { data: [{ booking: { bookingId: "fb-1", bookingRef: "REF1", status } }] } });

describe("LiteApiFlightSupplier", () => {
  it("verifies, prebooks every passenger with their passport, then books", async () => {
    const { http, calls } = fakeLiteApi({ "/flights/verify": verifyAnswer(), "/flights/prebooks": prebookAnswer(), "/flights/bookings": bookedAnswer() });
    const result = await new LiteApiFlightSupplier(http).book(flightRequest());

    expect(result).toEqual({ ok: true, value: { bookingId: "fb-1", confirmation: "REF1" } });
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.liteapi.travel/v3.0/flights/verify",
      "https://api.liteapi.travel/v3.0/flights/prebooks",
      "https://api.liteapi.travel/v3.0/flights/bookings",
    ]);
    expect(calls[1].body).toMatchObject({
      offerId: "flight-offer-1",
      usePaymentSdk: false,
      contact: { phoneCountryCode: "65", phoneNumber: "91234567" },
      passengers: [
        { passengerType: 0, firstName: "Daniel", documentType: "passport", documentNumber: "K1234567A", documentIssueCountry: "SG", documentExpiry: "2031-06-01" },
        { firstName: "Ben" },
      ],
    });
    expect(calls[2].body).toEqual({ prebookId: "fp-1", payment: { method: "ACC_CREDIT_CARD" } });
  });

  it("books nothing when the fare rose at verify", async () => {
    const { http, calls } = fakeLiteApi({ "/flights/verify": verifyAnswer(200.01), "/flights/prebooks": prebookAnswer() });
    expect(await new LiteApiFlightSupplier(http).book(flightRequest())).toMatchObject({ ok: false, error: { code: "price_changed" } });
    expect(calls).toHaveLength(1);
  });

  it("books nothing when verify says the price changed, even if the total looks fine", async () => {
    const { http } = fakeLiteApi({ "/flights/verify": verifyAnswer(200, { priceChanged: true }), "/flights/prebooks": prebookAnswer() });
    expect(await new LiteApiFlightSupplier(http).book(flightRequest())).toMatchObject({ ok: false, error: { code: "price_changed" } });
  });

  it("books nothing when the price rose between verify and prebook", async () => {
    const { http, calls } = fakeLiteApi({ "/flights/verify": verifyAnswer(), "/flights/prebooks": prebookAnswer(205), "/flights/bookings": bookedAnswer() });
    expect(await new LiteApiFlightSupplier(http).book(flightRequest())).toMatchObject({ ok: false, error: { code: "price_changed" } });
    expect(calls).toHaveLength(2);
  });

  it("passes the airline's refusal on as rejected", async () => {
    const { http } = fakeLiteApi({ "/flights/verify": verifyAnswer(), "/flights/prebooks": { status: 400, body: { error: { code: 43002, message: "invalid name" } } } });
    expect(await new LiteApiFlightSupplier(http).book(flightRequest())).toMatchObject({ ok: false, error: { code: "rejected" } });
  });

  it("says the fare is gone when it has expired", async () => {
    const { http } = fakeLiteApi({ "/flights/verify": { status: 404, body: { error: { code: 42004 } } } });
    expect(await new LiteApiFlightSupplier(http).book(flightRequest())).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });

  it("cancels a booking that is neither confirmed nor waiting for confirmation", async () => {
    const { http, calls } = fakeLiteApi({ "/flights/verify": verifyAnswer(), "/flights/prebooks": prebookAnswer(), "/flights/bookings": bookedAnswer("CREATED"), "/cancellations": { body: { data: { status: "CANCELLED" } } } });
    expect(await new LiteApiFlightSupplier(http).book(flightRequest())).toMatchObject({ ok: false, error: { code: "rejected" } });
    expect(calls.at(-1)?.url).toBe("https://api.liteapi.travel/v3.0/flights/bookings/fb-1/cancellations");
  });

  it("treats a 202 on cancel as pending and a 200 as cancelled", async () => {
    const pending = fakeLiteApi({ "/cancellations": { status: 202, body: { data: { status: "CONFIRMED" } } } });
    expect(await new LiteApiFlightSupplier(pending.http).cancel("fb-1")).toEqual({ ok: true, value: "pending" });
    const done = fakeLiteApi({ "/cancellations": { status: 200, body: { data: { status: "CANCELLED" } } } });
    expect(await new LiteApiFlightSupplier(done.http).cancel("fb-1")).toEqual({ ok: true, value: "cancelled" });
  });

  it("treats cancelling an already cancelled flight as done and a cancel under way as pending", async () => {
    const already = fakeLiteApi({ "/cancellations": { status: 409, body: { error: { code: 46004 } } } });
    expect(await new LiteApiFlightSupplier(already.http).cancel("fb-1")).toEqual({ ok: true, value: "cancelled" });
    const underway = fakeLiteApi({ "/cancellations": { status: 409, body: { error: { code: 46005 } } } });
    expect(await new LiteApiFlightSupplier(underway.http).cancel("fb-1")).toEqual({ ok: true, value: "pending" });
  });

  it("reports an airline outage on cancel as temporary", async () => {
    const down = fakeLiteApi({ "/cancellations": { status: 502, body: { error: { code: 56002 } } } });
    expect(await new LiteApiFlightSupplier(down.http).cancel("fb-1")).toMatchObject({ ok: false, error: { code: "temporary" } });
  });
});
