import Link from "next/link";
import { Suspense } from "react";
import { Avatar } from "@/components/avatar";
import { AppBar, Screen } from "@/components/screen";
import { getContainer } from "@/server/container";
import { readInviteToken, currentMember } from "@/server/session";
import { InvitePanel } from "./invite-panel";

export default function GroupPage({ params }: PageProps<"/g/[groupId]">) {
  return (
    <Screen>
      <Suspense fallback={<AppBar title="Group" />}>
        <Group params={params} />
      </Suspense>
    </Screen>
  );
}

const plural = (count: number): string => `${count} ${count === 1 ? "participant" : "participants"}`;

async function Group({ params }: { readonly params: PageProps<"/g/[groupId]">["params"] }) {
  const { groupId } = await params;
  const me = await currentMember(groupId);

  // A stranger gets the same answer for a group that exists and one that does not.
  if (!me) {
    return (
      <>
        <AppBar title="Group" />
        <main className="flex flex-1 flex-col items-center gap-3 px-8 pt-20 text-center">
          <Avatar name="?" size={96} />
          <h2 className="mt-2 text-xl font-semibold">You&apos;re not in this group</h2>
          <p className="text-muted-foreground">Open the invite link someone sent you to join.</p>
          <Link href="/" className="mt-4 text-sm font-medium text-primary">
            Start your own group
          </Link>
        </main>
      </>
    );
  }

  const { groups } = getContainer();
  const [group, people] = await Promise.all([groups.find(groupId), groups.joinedMembers(groupId)]);
  if (!group.ok) return <AppBar title="Group" />;

  const inviteToken = me.isOrganiser ? await readInviteToken(groupId) : null;

  return (
    <>
      <AppBar title={group.value.name} subtitle={`Group · ${plural(people.length)}`} />
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
          <ul>
            {people.map((person) => (
              <li key={person.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
                <Avatar name={person.displayName} size={40} />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {person.displayName}
                  {person.id === me.id ? <span className="font-normal text-muted-foreground"> (You)</span> : null}
                </span>
                {person.isOrganiser ? <span className="rounded-full border border-success px-2 py-0.5 text-xs font-medium text-success">Group admin</span> : null}
              </li>
            ))}
          </ul>
        </section>

        <p className="text-center text-sm text-muted-foreground">The group chat opens here next.</p>
      </main>
    </>
  );
}
