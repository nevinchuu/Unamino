import { Suspense } from "react";
import { AppBar, Screen } from "@/components/screen";
import { INITIAL_MESSAGES, loadChat } from "@/server/chat";
import { getContainer } from "@/server/container";
import { currentMember } from "@/server/session";
import { ChatView } from "./chat-view";
import { NotAMember } from "./not-a-member";

// Sending a message that calls the agent starts a run of about a minute, which the server finishes after replying.
export const maxDuration = 300;

export default function ChatPage({ params }: PageProps<"/g/[groupId]">) {
  return (
    <Screen className="h-dvh">
      <Suspense fallback={<AppBar title="Group" />}>
        <Chat params={params} />
      </Suspense>
    </Screen>
  );
}

async function Chat({ params }: { readonly params: PageProps<"/g/[groupId]">["params"] }) {
  const { groupId } = await params;
  const me = await currentMember(groupId);
  if (!me) return <NotAMember />;

  const { groups, chat } = getContainer();
  const [group, initial] = await Promise.all([groups.find(groupId), loadChat(chat, groupId, { afterSeq: null, limit: INITIAL_MESSAGES })]);
  if (!group.ok) return <NotAMember />;

  return <ChatView groupId={groupId} groupName={group.value.name} meId={me.id} isOrganiser={me.isOrganiser} initial={initial} />;
}
