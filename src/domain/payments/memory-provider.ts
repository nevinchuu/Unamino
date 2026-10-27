import { err, ok, type Result } from "@/lib/result";
import type { Hold, HoldRequest, HoldStatus, PaymentError, PaymentProvider } from "./types";

interface MutableHold {
  id: string;
  status: HoldStatus;
  amountMinor: number;
  heldMinor: number;
  chargedMinor: number;
  currency: string;
  owner: Hold["owner"];
  lastError: string | null;
}

const fail = (code: PaymentError["code"], message: string): Result<never, PaymentError> => err({ code, message });

/**
 * A payment provider that keeps everything in memory and follows the same rules as Stripe's manual-capture holds,
 * which were checked against Stripe's test mode (see the contract tests). For tests of the code that uses holds.
 */
export class MemoryPaymentProvider implements PaymentProvider {
  private readonly holds = new Map<string, MutableHold>();
  private readonly byKey = new Map<string, string>();
  readonly calls: string[] = [];
  /** Makes the next call of this kind fail as if the provider could not be reached. */
  readonly outages = new Set<"createHold" | "getHold" | "capture" | "release">();

  private view(hold: MutableHold): Hold {
    return { ...hold, clientSecret: hold.status === "awaiting_card" || hold.status === "held" ? `${hold.id}_secret` : null };
  }

  private down(call: "createHold" | "getHold" | "capture" | "release"): Result<never, PaymentError> | null {
    this.calls.push(call);
    return this.outages.has(call) ? fail("unavailable", `${call} is down`) : null;
  }

  async createHold(request: HoldRequest): Promise<Result<Hold, PaymentError>> {
    const outage = this.down("createHold");
    if (outage) return outage;
    if (!Number.isSafeInteger(request.amountMinor) || request.amountMinor <= 0) return fail("invalid_request", "A hold needs a positive whole amount");
    if (!/^[A-Za-z]{3}$/.test(request.currency)) return fail("invalid_request", "A currency is three letters");

    const existing = this.byKey.get(request.idempotencyKey);
    if (existing) return ok(this.view(this.holds.get(existing) as MutableHold));

    const hold: MutableHold = {
      id: `hold_${this.holds.size + 1}`,
      status: "awaiting_card",
      amountMinor: request.amountMinor,
      heldMinor: 0,
      chargedMinor: 0,
      currency: request.currency.toUpperCase(),
      owner: request.owner,
      lastError: null,
    };
    this.holds.set(hold.id, hold);
    this.byKey.set(request.idempotencyKey, hold.id);
    return ok(this.view(hold));
  }

  async getHold(holdId: string): Promise<Result<Hold, PaymentError>> {
    const outage = this.down("getHold");
    if (outage) return outage;
    const hold = this.holds.get(holdId);
    return hold ? ok(this.view(hold)) : fail("not_found", `No hold ${holdId}`);
  }

  // The idempotency key is not needed here: the rules below already make a repeated request harmless.
  async capture(holdId: string, amountMinor: number): Promise<Result<Hold, PaymentError>> {
    const outage = this.down("capture");
    if (outage) return outage;
    const hold = this.holds.get(holdId);
    if (!hold) return fail("not_found", `No hold ${holdId}`);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return fail("invalid_request", "A capture needs a positive whole amount");

    // Asking again for what was already charged is the same request arriving twice, not a mistake.
    if (hold.status === "captured") return hold.chargedMinor === amountMinor ? ok(this.view(hold)) : fail("invalid_state", "Already captured for a different amount");
    if (hold.status !== "held") return fail("invalid_state", `A ${hold.status} hold cannot be captured`);
    if (amountMinor > hold.heldMinor) return fail("amount_too_large", "More was asked for than is held");

    hold.status = "captured";
    hold.chargedMinor = amountMinor;
    hold.heldMinor = 0;
    return ok(this.view(hold));
  }

  async release(holdId: string): Promise<Result<Hold, PaymentError>> {
    const outage = this.down("release");
    if (outage) return outage;
    const hold = this.holds.get(holdId);
    if (!hold) return fail("not_found", `No hold ${holdId}`);
    if (hold.status === "released") return ok(this.view(hold));
    if (hold.status === "captured") return fail("invalid_state", "A captured hold cannot be released");

    hold.status = "released";
    hold.heldMinor = 0;
    return ok(this.view(hold));
  }

  /** What the browser does: the card is entered and confirmed, so the amount is set aside. */
  completeCard(holdId: string): void {
    const hold = this.holds.get(holdId);
    if (!hold || hold.status !== "awaiting_card") throw new Error(`Cannot complete the card for ${holdId}`);
    hold.status = "held";
    hold.heldMinor = hold.amountMinor;
    hold.lastError = null;
  }

  /** What the browser does when the card is refused: the hold stays waiting for another card. */
  failCard(holdId: string, reason = "Your card was declined."): void {
    const hold = this.holds.get(holdId);
    if (!hold || hold.status !== "awaiting_card") throw new Error(`Cannot fail the card for ${holdId}`);
    hold.lastError = reason;
  }

  /** For tests: every hold, as stored. */
  all(): readonly Hold[] {
    return [...this.holds.values()].map((hold) => this.view(hold));
  }
}
