import type { ChatModel, ModelMessage, ModelTurn, ToolSpec } from "./model";
import { numbersIn, ungroundedAmounts, withoutUngrounded } from "./grounding";

const DEFAULT_MAX_STEPS = 8;

/** What the working bubble says while each tool runs. Fixed wording, so nothing the model or the web wrote can end up in it. */
const PROGRESS_LABEL: Readonly<Record<string, string>> = {
  search_trip: "Searching flights and hotels…",
  propose_plan: "Putting the plan together…",
  web_research: "Looking it up on the web…",
};
export const THINKING_LABEL = "Thinking it through…";

/** What the working bubble says while this tool runs. */
export const progressLabel = (toolName: string): string => PROGRESS_LABEL[toolName] ?? THINKING_LABEL;

/** What to say if every line of a reply quoted a price that was never checked. */
export const UNCHECKED_PRICE_FALLBACK = "I'd rather not quote a price I haven't checked. Want me to search for real numbers?";

export type ConversationEnd =
  | { readonly status: "replied" }
  | { readonly status: "failed"; readonly code: "planner_unavailable" | "invalid_output" | "too_many_steps" };

export interface ConversationInput {
  readonly model: ChatModel;
  readonly system: string;
  /** The first message the model sees: the chat so far and what it is being asked. */
  readonly opening: string;
  readonly tools: readonly ToolSpec[];
  /** Runs a tool and returns what the model should read back. Never throws. */
  readonly runTool: (name: string, argumentsJson: string) => Promise<string>;
  /** Posts the agent's reply to the group. Only the final reply is ever posted, so a long search does not fill the chat. */
  readonly say: (text: string) => Promise<void>;
  /** Tells the working bubble what the agent is doing now. It is shown while the run goes on and never kept as a message. */
  readonly progress: (text: string) => Promise<void>;
  readonly note: (stage: string, data: unknown) => void;
  readonly maxSteps?: number;
}

/**
 * The agent's turn: the model reads the chat and decides for itself whether to answer, ask, or look something up.
 * It may use tools and read their results as many times as it needs, up to a limit, and its last plain message
 * is what the group hears. Prices in what it says are checked against what it was given.
 */
export async function runConversation(input: ConversationInput): Promise<ConversationEnd> {
  const { model, system, tools, runTool, say, progress, note } = input;
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
  const messages: ModelMessage[] = [{ role: "user", content: input.opening }];
  const given: number[] = [...numbersIn(input.opening)];
  let nudged = false;

  for (let step = 1; step <= maxSteps; step += 1) {
    const answer = await model.turn({ system, messages, tools });
    if (!answer.ok) {
      note("model_failed", { step, error: answer.error });
      return { status: "failed", code: answer.error.code === "planner_unavailable" ? "planner_unavailable" : "invalid_output" };
    }
    const turn: ModelTurn = answer.value;
    messages.push({ role: "assistant", content: turn.text, toolCalls: turn.toolCalls });
    note("model_turn", { step, text: turn.text, toolCalls: turn.toolCalls.map((call) => ({ name: call.name, arguments: call.arguments })) });

    if (turn.toolCalls.length === 0) {
      const reply = turn.text ?? "";
      const bad = ungroundedAmounts(reply, given);
      if (bad.length > 0 && !nudged) {
        nudged = true;
        note("grounding", { step, ungrounded: bad, action: "asked the model to fix its wording" });
        messages.push({ role: "user", content: `Your reply quoted ${bad.join(", ")}, which is not in any search result or in the chat. Say it again using only prices you were given, or leave the price out.` });
        continue;
      }
      const clean = bad.length > 0 ? (withoutUngrounded(reply, bad) ?? UNCHECKED_PRICE_FALLBACK) : reply;
      if (bad.length > 0) note("grounding", { step, ungrounded: bad, action: "removed the lines that quoted them" });
      await say(clean);
      return { status: "replied" };
    }

    // Words written alongside a tool call stay in the trace; the group sees a short fixed label instead.
    for (const call of turn.toolCalls) {
      await progress(progressLabel(call.name));
      const result = await runTool(call.name, call.arguments);
      note("tool_result", { step, tool: call.name, result: result.length > 4_000 ? `${result.slice(0, 4_000)}…` : result });
      given.push(...numbersIn(result));
      messages.push({ role: "tool", toolCallId: call.id, content: result });
    }
    await progress(THINKING_LABEL);
  }
  note("too_many_steps", { maxSteps });
  return { status: "failed", code: "too_many_steps" };
}
