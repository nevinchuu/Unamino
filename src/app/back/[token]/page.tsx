import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Avatar } from "@/components/avatar";
import { AppBar, Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { lookUpAccessLink } from "@/server/access-link";
import { getContainer } from "@/server/container";
import { currentMember } from "@/server/session";
import { continueWithAccessLink } from "./actions";

export default function AccessLinkPage({ params }: PageProps<"/back/[token]">) {
  return (
    <Screen>
      <AppBar title="Sign back in" />
      <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Opening link…</div>}>
        <Back params={params} />
      </Suspense>
    </Screen>
  );
}

async function Back({ params }: { readonly params: PageProps<"/back/[token]">["params"] }) {
  const { token } = await params;
  const found = await lookUpAccessLink(getContainer(), token);

  if (!found.ok) {
    return (
      <main className="flex flex-1 flex-col items-center gap-3 px-8 pt-20 text-center">
        <Avatar name="?" size={96} />
        <h2 className="mt-2 text-xl font-semibold">This link doesn&apos;t work</h2>
        <p className="text-muted-foreground">It may have been replaced by a newer one. Open the newest link, or ask the group admin to invite you again.</p>
        <Link href="/" className="mt-4 text-sm font-medium text-primary">
          Go to your trips
        </Link>
      </main>
    );
  }

  const { groupId, groupName, memberName } = found.preview;
  // A browser that is already signed in as this group's member just goes there.
  if (await currentMember(groupId)) redirect(`/g/${groupId}`);

  return (
    <main className="flex flex-1 flex-col items-center gap-2 px-8 pt-16 pb-10 text-center">
      <Avatar name={groupName} size={96} />
      <h2 className="mt-3 text-2xl font-semibold break-words">{groupName}</h2>
      <p className="text-muted-foreground">Sign back in as {memberName}?</p>
      <form action={continueWithAccessLink.bind(null, token)} className="mt-8 w-full">
        <Button type="submit" className="h-12 w-full rounded-full text-base font-semibold">
          Continue as {memberName}
        </Button>
      </form>
      <p className="mt-4 text-xs text-muted-foreground">Only continue if this is your own link.</p>
    </main>
  );
}
