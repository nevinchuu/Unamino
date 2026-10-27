/**
 * A light check on what the agent says: a dollar amount it writes must be one it was actually given, by a search
 * result or by the group's own chat. It is not a filter on the conversation. It only stops a made-up price.
 */

const AMOUNT = /(?:US\$|\$)\s?(\d(?:[\d,]*\d)?(?:\.\d+)?)/g;
const NUMBER = /\d(?:[\d,]*\d)?(?:\.\d+)?/g;
/** Rounding a price to whole dollars, or a share worked out from a total, is not inventing it. */
const TOLERANCE = 1;

const toNumber = (text: string): number => Number.parseFloat(text.replaceAll(",", ""));

/** Every number in some text. Searches and the chat are mined for these, so the agent can quote them back. */
export function numbersIn(text: string): readonly number[] {
  return (text.match(NUMBER) ?? []).map(toNumber).filter(Number.isFinite);
}

/** The dollar amounts in a message, as written. */
export const amountsIn = (text: string): readonly { readonly written: string; readonly value: number }[] =>
  [...text.matchAll(AMOUNT)].map((match) => ({ written: match[0], value: toNumber(match[1]) }));

/** Amounts in `text` that match none of the numbers the agent was given. */
export function ungroundedAmounts(text: string, given: readonly number[]): readonly string[] {
  return amountsIn(text)
    .filter(({ value }) => !given.some((known) => Math.abs(known - value) <= TOLERANCE))
    .map(({ written }) => written);
}

/**
 * The message with every line that quotes an ungrounded amount taken out, or null when nothing is left.
 * Used only after the agent has been asked once to fix its own wording and did not.
 */
export function withoutUngrounded(text: string, ungrounded: readonly string[]): string | null {
  const kept = text.split("\n").filter((line) => !ungrounded.some((amount) => line.includes(amount)));
  const joined = kept.join("\n").trim();
  return joined === "" ? null : joined;
}
