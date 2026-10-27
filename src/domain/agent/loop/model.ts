import type { Result } from "@/lib/result";
import type { PlannerError } from "@/domain/planner/errors";

/** A tool the model asked to use. `arguments` is the JSON text it wrote, which may not be valid. */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export type ModelMessage =
  | { readonly role: "user"; readonly content: string }
  | { readonly role: "assistant"; readonly content: string | null; readonly toolCalls: readonly ToolCall[] }
  | { readonly role: "tool"; readonly toolCallId: string; readonly content: string };

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  /** A JSON Schema object describing the arguments. */
  readonly parameters: Record<string, unknown>;
}

/** What the model said, and the tools it wants to use. A turn with no tool calls is its answer. */
export interface ModelTurn {
  readonly text: string | null;
  readonly toolCalls: readonly ToolCall[];
}

export interface ModelRequest {
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolSpec[];
}

/** The AI side of the conversation. The Meta Muse client implements this; tests use a scripted one. */
export interface ChatModel {
  turn(request: ModelRequest): Promise<Result<ModelTurn, PlannerError>>;
}
