import type { Result } from "@/lib/result";
import type { Cover } from "@/domain/split/types";
import type { RepositoryError } from "./repository";

/** Where the covers of a plan are kept. A plan has at most one cover for each pair of people. */
export interface CoverStore {
  /** In the order they were made. */
  list(planId: string): Promise<Result<readonly Cover[], RepositoryError>>;
  /** Adds the cover, or replaces the one this sponsor already has for this beneficiary. */
  save(planId: string, cover: Cover): Promise<Result<void, RepositoryError>>;
  /** Removes it. Removing one that is not there is fine. */
  remove(planId: string, sponsorId: string, beneficiaryId: string): Promise<Result<void, RepositoryError>>;
}
