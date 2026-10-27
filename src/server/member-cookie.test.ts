import { describe, expect, it } from "vitest";
import { isUuid } from "./ids";
import { INVITE_COOKIE_MAX_AGE_SECONDS, inviteCookieName, inviteCookieOptions, MEMBER_COOKIE_MAX_AGE_SECONDS, memberCookieName, memberCookieOptions } from "./member-cookie";

const GROUP = "3f2b8c1e-5a4d-4e0b-9c7a-1d2e3f4a5b6c";

describe("memberCookieName", () => {
  it("is one name per group", () => {
    expect(memberCookieName(GROUP)).toBe(`member_${GROUP}`);
    expect(memberCookieName("a3f2b8c1-5a4d-4e0b-9c7a-1d2e3f4a5b6c")).not.toBe(memberCookieName(GROUP));
  });

  it.each(["", "abc", `${GROUP}x`, `${GROUP}; Path=/`, "member_x", `${GROUP}\n`, "../etc"])("gives no name for %j, so nothing odd can end up in a cookie name", (id) => {
    expect(memberCookieName(id)).toBeNull();
  });
});

describe("memberCookieOptions", () => {
  it("keeps the token away from scripts and other sites", () => {
    expect(memberCookieOptions(true)).toEqual({ httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: MEMBER_COOKIE_MAX_AGE_SECONDS });
  });

  it("only requires HTTPS in production, so local development over http works", () => {
    expect(memberCookieOptions(false).secure).toBe(false);
  });
});

describe("isUuid", () => {
  it("accepts either letter case", () => {
    expect(isUuid(GROUP.toUpperCase())).toBe(true);
  });
});

describe("invite cookie", () => {
  it("lasts one hour", () => {
    expect(INVITE_COOKIE_MAX_AGE_SECONDS).toBe(3600);
    expect(inviteCookieOptions(true)).toEqual({ httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 3600 });
  });

  it("is named per group, apart from the member cookie, and only for a real group id", () => {
    expect(inviteCookieName(GROUP)).toBe(`invite_${GROUP}`);
    expect(inviteCookieName(GROUP)).not.toBe(memberCookieName(GROUP));
    expect(inviteCookieName("nope")).toBeNull();
  });
});
