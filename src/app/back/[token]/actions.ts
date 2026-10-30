"use server";

import { redirect } from "next/navigation";
import { lookUpAccessLink } from "@/server/access-link";
import { getContainer } from "@/server/container";
import { rememberMember } from "@/server/session";

/**
 * Signs this browser in as the person the access link belongs to and takes it to their group. Opening the page changes
 * nothing; only this button does, so a link preview or a prefetch cannot sign anyone in.
 */
export async function continueWithAccessLink(token: string): Promise<void> {
  const found = await lookUpAccessLink(getContainer(), token);
  // A link that stopped working between the page and the button goes back to the page, which says so.
  if (!found.ok) redirect(`/back/${encodeURIComponent(token)}`);
  await rememberMember(found.preview.groupId, token);
  redirect(`/g/${found.preview.groupId}`);
}
