import Link from "next/link";
import { Suspense } from "react";
import { Avatar } from "@/components/avatar";
import { AppBar, Screen } from "@/components/screen";
import { getContainer } from "@/server/container";
import { readInviteToken, currentMember } from "@/server/session";
import { AccessLinkPanel } from "../access-link-panel";
import { GroupDangerZone, ParticipantList } from "../group-controls";
import { InvitePanel } from "../invite-panel";
import { NotAMember } from "../not-a-member";

export default function GroupInfoPage({ params }: PageProps<"/g/[groupId]/info">) {
  return (
    <Screen>
      <Suspense fallback={<AppBar title="Group info" />}>
        <Group params={params} />
      </Suspense>
    </Screen>
  );
}

const plural = (count: number): string => `${count} ${count === 1 ? "participant" : "participants"}`;

async function Group({ params }: { readonly params: PageProps<"/g/[groupId]/info">["params"] }) {
  const { groupId } = await params;
  const me = await currentMember(groupId);

  if (!me) return <NotAMember />;

  const { groups } = getContainer();
  const [group, people] = await Promise.all([groups.find(groupId), groups.joinedMembers(groupId)]);
  if (!group.ok) return <AppBar title="Group" />;

  const inviteToken = me.isOrganiser ? await readInviteToken(groupId) : null;

  return (
    <>
      <AppBar title="Group info" backHref={`/g/${groupId}`} />
      <main className="flex flex-1 flex-col gap-4 px-4 py-6">
        <div className="flex flex-col items-center gap-2 pb-2 text-center">
          <Avatar name={group.value.name} size={96} />
          <p className="text-sm text-muted-foreground">Group · {plural(people.length)}</p>
        </div>

        {me.isOrganiser ? <InvitePanel groupId={groupId} groupName={group.value.name} joinPath={inviteToken ? `/join/${inviteToken}` : null} /> : null}

        <section aria-labelledby="people-heading" className="rounded-xl bg-card p-2 shadow-sm">
          <h2 id="people-heading" className="px-2 pt-2 pb-1 text-sm font-medium text-muted-foreground">
            {plural(people.length)}
          </h2>
          <ParticipantList
            groupId={groupId}
            viewerIsAdmin={me.isOrganiser}
            people={people.map((person) => ({ id: person.id, name: person.displayName, isMe: person.id === me.id, isAdmin: person.isOrganiser }))}
          />
        </section>

        <AccessLinkPanel groupId={groupId} groupName={group.value.name} />

        <GroupDangerZone groupId={groupId} groupName={group.value.name} isAdmin={me.isOrganiser} />

        <p className="px-2 text-center text-xs text-muted-foreground">
          A group with a booked trip is deleted 30 days after the trip ends, and one that never booked after 30 quiet days.{" "}
          <Link href="/privacy" className="font-medium text-primary underline underline-offset-2">
            Privacy notice
          </Link>
        </p>
      </main>
    </>
  );
}
