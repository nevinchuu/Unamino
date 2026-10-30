import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

/** A secret for a join link or a member's browser. 256 random bits, safe to put in a URL or a cookie. */
export const generateToken = (): string => randomBytes(TOKEN_BYTES).toString("base64url");

/** Whether something has the shape of a token, so a made-up address is turned away before the database is asked about it. */
export const isTokenShaped = (value: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(value);

/** Only this is ever stored. Tokens are random and long, so a plain fast hash is enough: there is nothing to guess. */
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
