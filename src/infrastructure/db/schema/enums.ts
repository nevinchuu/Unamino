import { pgEnum } from "drizzle-orm/pg-core";
import { OFFER_KINDS } from "@/domain/offers/schema";
import { APPROVAL_STATUSES, PLAN_AGREEMENT_STATUSES, PLAN_STATUSES } from "@/domain/plan/statuses";

export const MEMBER_STATUSES = ["invited", "joined", "left"] as const;
export const MESSAGE_KINDS = ["human", "agent", "system"] as const;
export const AGENT_RUN_STATUSES = ["running", "done", "failed"] as const;
export const EFFECT_STATUSES = ["pending", "done", "failed"] as const;

export const memberStatus = pgEnum("member_status", MEMBER_STATUSES);
export const messageKind = pgEnum("message_kind", MESSAGE_KINDS);
export const agentRunStatus = pgEnum("agent_run_status", AGENT_RUN_STATUSES);
export const effectStatus = pgEnum("effect_status", EFFECT_STATUSES);

// These reuse the domain's own lists, so the database and the state machine cannot disagree on a status.
export const planStatus = pgEnum("plan_status", PLAN_STATUSES);
export const planAgreement = pgEnum("plan_agreement", PLAN_AGREEMENT_STATUSES);
export const approvalStatus = pgEnum("approval_status", APPROVAL_STATUSES);
export const offerKind = pgEnum("offer_kind", OFFER_KINDS);
