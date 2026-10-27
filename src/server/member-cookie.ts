import { isUuid } from "./ids";

/** About a trip's planning time. After this the person joins again with the link. */
export const MEMBER_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** One cookie per group, so a browser can be in several groups at once. Null for an id that is not a group id. */
export const memberCookieName = (groupId: string): string | null => (isUuid(groupId) ? `member_${groupId}` : null);

export interface MemberCookieOptions {
  readonly httpOnly: true;
  readonly sameSite: "lax";
  readonly secure: boolean;
  readonly path: "/";
  readonly maxAge: number;
}

/** The token is a password, so scripts never see it, other sites never send it, and in production it only travels over HTTPS. */
export const memberCookieOptions = (production: boolean): MemberCookieOptions => ({
  httpOnly: true,
  sameSite: "lax",
  secure: production,
  path: "/",
  maxAge: MEMBER_COOKIE_MAX_AGE_SECONDS,
});

/** The invite link is shown to the organiser for this long after it is made, so it can be copied and shared without hurry. */
export const INVITE_COOKIE_MAX_AGE_SECONDS = 60 * 60;

/** Holds the organiser's invite link secret. One per group. Null for an id that is not a group id. */
export const inviteCookieName = (groupId: string): string | null => (isUuid(groupId) ? `invite_${groupId}` : null);

export const inviteCookieOptions = (production: boolean): MemberCookieOptions => ({
  ...memberCookieOptions(production),
  maxAge: INVITE_COOKIE_MAX_AGE_SECONDS,
});
