import { formatMinor } from "./format-money";

/** How far below the approved amount the worked example puts the final price. Only an illustration. */
const EXAMPLE_PRICE_FRACTION = 0.93;
/** Below this the difference would be a few cents, which makes a poor example. */
const MIN_EXAMPLE_MINOR = 1_000;

/** The three steps money goes through, in the order they happen. */
export const MONEY_STEPS = [
  { when: "Now", what: "Set aside at your bank" },
  { when: "Everyone's in", what: "Trip booked" },
  { when: "Then", what: "Your share is charged" },
] as const;

export interface MoneyExplainerInput {
  readonly amountMinor: number;
  readonly currency: string;
  /** Shown as the way to reach someone about a charge. Left out when there is none. */
  readonly supportEmail: string | null;
  /** The key is a Stripe test key, so no real money moves. */
  readonly testMode: boolean;
  /** Booking and holds are only pretended, with no card at all. */
  readonly demo: boolean;
}

export interface MoneyExplainer {
  readonly heading: string;
  /** The few plain lines that are always shown. */
  readonly lead: readonly string[];
  readonly toggle: string;
  readonly analogy: string;
  readonly points: readonly { readonly label: string; readonly text: string }[];
  readonly goodToKnow: string;
  readonly support: string | null;
  /** "Test mode: ..." or "Demo: ...", or null for the real thing. */
  readonly modeNote: string | null;
}

/** A price a little under the approved amount, and what would be released, to show how a hold is settled. Null when the amount is too small to make it clear. */
export function holdExample(amountMinor: number, currency: string): { readonly finalText: string; readonly releasedText: string } | null {
  if (amountMinor < MIN_EXAMPLE_MINOR) return null;
  const finalMinor = Math.floor(amountMinor * EXAMPLE_PRICE_FRACTION);
  return { finalText: formatMinor(finalMinor, currency), releasedText: formatMinor(amountMinor - finalMinor, currency) };
}

/**
 * What a person is told about where their money is before they approve an amount, for someone who has never met the
 * word "hold". One place, so the plan page, the chat panel and the card form say the same thing in the same words.
 */
export function moneyExplainer(input: MoneyExplainerInput): MoneyExplainer {
  const amount = formatMinor(input.amountMinor, input.currency);
  const example = holdExample(input.amountMinor, input.currency);
  return {
    heading: "Where your money is",
    lead: [
      "Right now it is in your own bank account. Nothing has been taken.",
      `When you add your card, your bank sets aside ${amount} for this trip. It is still your money, but you cannot spend it until the trip is booked or the hold ends.`,
      "Only after everyone is in and every booking is confirmed do we take your share. Anything left over goes back to you.",
    ],
    toggle: "What is a hold?",
    analogy: "A hold works like the deposit a hotel asks for at check-in. The hotel does not take your money. It asks your bank to keep that amount free in case it is needed.",
    points: [
      { label: "In your banking app", text: `you will see a pending payment of ${amount}, and your available balance will be ${amount} lower. Your real balance has not changed.` },
      ...(example ? [{ label: "Example", text: `you approve ${amount}. By booking time the price is ${example.finalText}. We take ${example.finalText}, and the other ${example.releasedText} is released straight away.` }] : []),
      { label: "If the trip does not happen", text: "the hold is cancelled. Most banks free the money within a few days." },
      { label: "How long it can last", text: "up to about 7 days. We book as soon as everyone is in, and cancel the hold if the plan ends first." },
      { label: "Who has it", text: "your bank keeps it set aside; Stripe, our payment processor, asks them to. Unamino never holds your money and never sees your card number." },
    ],
    goodToKnow: "Good to know: everyone pays in USD, so a card in another currency may add your bank's conversion fee. Unamino adds no fee.",
    support: input.supportEmail ? `Something wrong with a charge? Email ${input.supportEmail}.` : null,
    modeNote: input.demo ? "Demo: no real card is held and no money moves." : input.testMode ? "Test mode: no real money moves." : null,
  };
}
