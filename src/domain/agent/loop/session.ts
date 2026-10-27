import type { ConstraintSet } from "@/domain/constraints/schema";
import type { Group, Member } from "@/domain/group/types";
import type { Offer } from "@/domain/offers/schema";
import type { Planner } from "@/domain/planner/planner";
import type { CompleteTrip } from "@/domain/trip/brief";
import type { SearchRecord } from "@/domain/trip/search";
import type { AgentDeps } from "../run-agent";
import type { AgentRun } from "../ports";

export interface RosterEntry {
  /** What the model calls this person: m1, m2, ... */
  readonly alias: string;
  readonly member: Member;
}

/** What one turn of the agent has found so far. The tools read and write it; the model only sees their answers. */
export interface Session {
  trip: CompleteTrip | null;
  searches: readonly SearchRecord[];
  /** The offers the model may choose from, by the short id it was shown (F1, H2, ...). */
  offersByAlias: ReadonlyMap<string, Offer>;
  /** The plan this turn made or found, so the reply carries its card. */
  planId: string | null;
}

/** Everything a tool needs, gathered once per turn. */
export interface ToolEnv {
  readonly deps: AgentDeps;
  readonly run: AgentRun;
  readonly group: Group;
  readonly roster: readonly RosterEntry[];
  readonly now: Date;
  /** Reads people's limits from the chat. Started at the beginning of the turn, so a search does not wait for it. */
  readonly constraints: () => Promise<ConstraintSet>;
  /** For the free-time ideas, which still use structured answers. */
  readonly planner: Planner;
  readonly session: Session;
  readonly note: (stage: string, data: unknown) => void;
}

export const newSession = (): Session => ({ trip: null, searches: [], offersByAlias: new Map(), planId: null });

export const members = (env: ToolEnv): readonly Member[] => env.roster.map((entry) => entry.member);
