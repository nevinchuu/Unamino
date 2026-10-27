import type { MessageKind } from "./types";

const MENTION = "@agent";

/** `@agent` as a word of its own: not inside an email address, and not the start of a longer word like @agents. */
const AGENT_MENTION_SOURCE = String.raw`(^|[^\w@])@agent(?![\w-])`;
const AGENT_MENTION = new RegExp(AGENT_MENTION_SOURCE, "i");

export const mentionsAgent = (body: string): boolean => AGENT_MENTION.test(body);

export interface TextPart {
  readonly text: string;
  readonly isMention: boolean;
}

/**
 * A message cut into plain text and the `@agent` mentions in it, by the same rule that decides whether a message
 * calls the agent, so what is highlighted is exactly what counts. The parts always add up to the original text.
 */
export function splitAgentMentions(body: string): readonly TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const match of body.matchAll(new RegExp(AGENT_MENTION_SOURCE, "gi"))) {
    const start = match.index + match[1].length;
    if (start > cursor) parts.push({ text: body.slice(cursor, start), isMention: false });
    parts.push({ text: body.slice(start, start + MENTION.length), isMention: true });
    cursor = start + MENTION.length;
  }
  if (cursor < body.length) parts.push({ text: body.slice(cursor), isMention: false });
  return parts;
}

/**
 * Does this message call the agent? Typing `@agent` does, and so does replying to one of the agent's own messages,
 * which is how a group answers its questions. Only people can call it: the agent's and the system's own lines never
 * do, so the agent cannot start itself.
 */
export function callsAgent(input: { readonly kind: MessageKind; readonly body: string; readonly repliesToKind: MessageKind | null }): boolean {
  if (input.kind !== "human") return false;
  return mentionsAgent(input.body) || input.repliesToKind === "agent";
}
