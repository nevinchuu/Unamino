const UNIQUE_VIOLATION = "23505";
const MAX_CAUSE_DEPTH = 5;

interface PgErrorLike {
  readonly code?: unknown;
  readonly constraint_name?: unknown;
  readonly cause?: unknown;
}

/** Drizzle wraps the driver's error, so the Postgres details can be a few `cause`s down. */
function findPgError(error: unknown): PgErrorLike | null {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current && typeof current === "object"; depth += 1) {
    const candidate = current as PgErrorLike;
    if (typeof candidate.code === "string") return candidate;
    current = candidate.cause;
  }
  return null;
}

/** Was this a unique-index or unique-constraint violation, optionally on a named one? */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pg = findPgError(error);
  if (!pg || pg.code !== UNIQUE_VIOLATION) return false;
  return constraint === undefined || pg.constraint_name === constraint;
}
