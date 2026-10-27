import type { Result } from "@/lib/result";
import type { RepositoryError } from "./repository";
import type { PlanStatus } from "./statuses";

/** What anyone holding a plan id may see: counts and a state, no names, amounts or tokens. */
export interface PlanPublicStatus {
  readonly status: PlanStatus;
  readonly memberCount: number;
  readonly agreedCount: number;
  readonly approvedCount: number;
  readonly deadlineAt: Date;
}

export interface PlanStatusReader {
  read(planId: string): Promise<Result<PlanPublicStatus, RepositoryError>>;
}
