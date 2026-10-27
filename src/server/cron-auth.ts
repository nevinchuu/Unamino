import { createHash, timingSafeEqual } from "node:crypto";

/** A short secret can be guessed, so a short one is treated as no secret at all. */
export const MIN_CRON_SECRET_LENGTH = 32;

const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

/**
 * Is this the scheduler calling? Fails closed: with no secret, or one that is too short, nothing is authorised.
 * Both sides are hashed first so the comparison takes the same time whatever the lengths are.
 */
export function isCronAuthorized(authorization: string | null, secret: string | null): boolean {
  if (!secret || secret.length < MIN_CRON_SECRET_LENGTH || !authorization) return false;
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
}
