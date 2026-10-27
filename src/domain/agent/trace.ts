/**
 * A record of what the agent did and why, for a developer looking at one run. It is only ever written to a local
 * file in development (see `infrastructure/trace`), never in production, because it holds the group's chat.
 */
export interface TraceEvent {
  readonly at: string;
  readonly source: "agent" | "muse";
  readonly stage: string;
  readonly data: unknown;
}

/** Receives events. Must never throw: tracing cannot be allowed to break a run. */
export type TraceSink = (event: TraceEvent) => void;
