import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Avatar } from "@/components/avatar";
import { AppBar, Screen } from "@/components/screen";
import { MAX_GROUP_MEMBERS } from "@/domain/group/types";
import { getContainer } from "@/server/container";
import { currentMember } from "@/server/session";
import { JoinForm } from "./join-form";

export default function JoinPage({ params }: PageProps<"/join/[token]">) {
  return (
    <Screen>
      <AppBar title="Group invite" />
      <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Opening invite…</div>}>
        <Invite params={params} />
      </Suspense>
    </Screen>
  );
}

const plural = (count: number): string => `${count} ${count === 1 ? "participant" : "participants"}`;

async function Invite({ params }: { readonly params: PageProps<"/join/[token]">["params"] }) {
  const { token } = await params;
  const preview = await getContainer().groups.describeJoinLink(token);

  if (!preview.ok) {
    return (
      <main className="flex flex-1 flex-col items-center gap-3 px-8 pt-20 text-center">
        <Avatar name="?" size={96} />
        <h2 className="mt-2 text-xl font-semibold">This invite doesn&apos;t work</h2>
        <p className="text-muted-foreground">It may have been reset or switched off. Ask the person who made the group for a new link.</p>
        <Link href="/new" className="mt-4 text-sm font-medium text-primary">
          Start your own group
        </Link>
      </main>
    );
  }

  const { groupId, groupName, inviterName, memberCount, isFull } = preview.value;
  // Opening the link again from a browser that is already in the group just goes there.
  if (await currentMember(groupId)) redirect(`/g/${groupId}`);

  return (
    <main className="flex flex-1 flex-col items-center gap-2 px-8 pt-16 pb-10 text-center">
      <Avatar name={groupName} size={112} />
      <h2 className="mt-3 text-2xl font-semibold break-words">{groupName}</h2>
      <p className="text-sm text-muted-foreground">Group · {plural(memberCount)}</p>
      {inviterName ? <p className="mt-1 text-muted-foreground">{inviterName} invited you to join this group</p> : null}

      <div className="mt-10 flex w-full flex-col items-center text-left">
        {isFull ? (
          <p role="status" className="w-full rounded-lg bg-muted px-4 py-3 text-center text-sm text-muted-foreground">
            This group already has {MAX_GROUP_MEMBERS} people, so it&apos;s full.
          </p>
        ) : (
          <>
            <JoinForm joinToken={token} />
            <p className="mt-6 text-center text-xs text-muted-foreground">
              This group plans trips together with an AI helper. To join a booking you will later give traveller details, and a card is held, not charged, until everyone is in.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
