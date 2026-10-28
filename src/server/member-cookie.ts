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

const MEMBER_COOKIE_PREFIX = "member_";

export interface Membership {
  readonly groupId: string;
  /** The member's secret token. Whether it still opens that group is for the server to check. */
  readonly token: string;
}

/** The groups this browser holds a member cookie for, so the trips list knows which chats to show. Cookies that are not member cookies, or have no value, are skipped. */
export function membershipsFromCookies(cookies: readonly { readonly name: string; readonly value: string }[]): Membership[] {
  return cookies.flatMap(({ name, value }) => {
    if (!name.startsWith(MEMBER_COOKIE_PREFIX) || !value) return [];
    const groupId = name.slice(MEMBER_COOKIE_PREFIX.length);
    return isUuid(groupId) ? [{ groupId, token: value }] : [];
  });
}
