import "server-only";
import { cookies } from "next/headers";
import type { Member } from "@/domain/group/types";
import { authenticateInGroup } from "./authenticate";
import { getContainer } from "./container";
import { inviteCookieName, inviteCookieOptions, memberCookieName, memberCookieOptions } from "./member-cookie";

/**
 * The member acting in this group, or null. Every Server Action and Route Handler that changes anything calls
 * this first, because those can be called directly, whatever page they were meant to be used from.
 */
export async function currentMember(groupId: string): Promise<Member | null> {
  const name = memberCookieName(groupId);
  if (!name) return null;
  const token = (await cookies()).get(name)?.value;
  return authenticateInGroup(getContainer().groups, groupId, token);
}

/** Keeps the member's token in their browser. Only works inside a Server Action or Route Handler. */
export async function rememberMember(groupId: string, memberToken: string): Promise<void> {
  const name = memberCookieName(groupId);
  // The id comes from our own database here, so anything else is a bug and not something to recover from.
  if (!name) throw new Error("Cannot remember a member of a group with a malformed id");
  (await cookies()).set(name, memberToken, memberCookieOptions(process.env.NODE_ENV === "production"));
}

/** Holds the invite link secret for a while after it is made, because only its hash is stored. Server Action or Route Handler only. */
export async function rememberInviteToken(groupId: string, joinToken: string): Promise<void> {
  const name = inviteCookieName(groupId);
  if (!name) throw new Error("Cannot remember an invite for a group with a malformed id");
  (await cookies()).set(name, joinToken, inviteCookieOptions(process.env.NODE_ENV === "production"));
}

/** The invite link secret made in the last hour in this browser, if any. */
export async function readInviteToken(groupId: string): Promise<string | null> {
  const name = inviteCookieName(groupId);
  return name ? ((await cookies()).get(name)?.value ?? null) : null;
}
