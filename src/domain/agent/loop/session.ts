import type { ConstraintSet } from "@/domain/constraints/schema";
import type { Group, Member } from "@/domain/group/types";
import type { Offer } from "@/domain/offers/schema";
import type { Planner } from "@/domain/planner/planner";
import type { CompleteTrip } from "@/domain/trip/brief";
import type { SearchRecord } from "@/domain/trip/search";
import type { AgentDeps } from "../run-agent";
import type { AgentRun } from "../ports";
import type { WebResearcher } from "./research";

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
  /** Who the last search was for on flights, when that is not everyone. Null means everyone flies. */
  flyerIds: readonly string[] | null;
  /** The plan this turn made or found, so the reply carries its card. */
  planId: string | null;
  /** How many times the web has been searched this turn, which is limited. */
  researchCalls: number;
}

/** Everything a tool needs, gathered once per turn. */
export interface ToolEnv {
  readonly deps: AgentDeps;
  readonly run: AgentRun;
  readonly group: Group;
  readonly roster: readonly RosterEntry[];
  readonly now: Date;
  /** This turn was started by someone asking for changes, so the open plan may be replaced even if no limit changed. */
  readonly changeRequested: boolean;
  /** Reads people's limits from the chat. Started at the beginning of the turn, so a search does not wait for it. */
  readonly constraints: () => Promise<ConstraintSet>;
  /** For the free-time ideas, which still use structured answers. */
  readonly planner: Planner;
  readonly session: Session;
  /** Null when web search is switched off, in which case the model is not offered the tool. */
  readonly researcher: WebResearcher | null;
  readonly note: (stage: string, data: unknown) => void;
}

export const newSession = (): Session => ({ trip: null, searches: [], offersByAlias: new Map(), flyerIds: null, planId: null, researchCalls: 0 });

export const members = (env: ToolEnv): readonly Member[] => env.roster.map((entry) => entry.member);
