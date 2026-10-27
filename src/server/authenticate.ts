import type { GroupRepository } from "@/domain/group/repository";
import type { Member } from "@/domain/group/types";

/**
 * Who is this, in this group? A token that belongs to a member of another group must not open this one,
 * so the member's group is checked as well as the token.
 */
export async function authenticateInGroup(groups: Pick<GroupRepository, "authenticate">, groupId: string, token: string | undefined): Promise<Member | null> {
  if (!token) return null;
  const found = await groups.authenticate(token);
  return found.ok && found.value.groupId === groupId ? found.value : null;
}
