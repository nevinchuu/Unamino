"use client";

import { ArrowDown, ArrowLeft, ArrowUp, Loader2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgentAvatar, AvatarStack } from "@/components/avatar";
import { mentionsAgent } from "@/domain/group/mention";
import { layoutMessages, snippet } from "@/lib/chat-format";
import { lastSeq, mergeMessages, visiblePending, type PendingMessage } from "@/lib/chat-state";
import { latestPlan } from "@/lib/trip-list";
import type { ChatMessageDto, ChatSnapshot, EarlierPage, PlanCardDto } from "@/server/chat";
import { POLL_LIMIT } from "@/lib/chat-limits";
import { sendMessage } from "./actions";
import { ActionSheet } from "./action-sheet";
import { Composer } from "./composer";
import { MessageRow, type RowModel } from "./message-row";
import { PersonasSheet } from "./personas-sheet";
import { PlanStrip } from "./plan-strip";
import { SaveLinkPrompt } from "./save-link-prompt";

const POLL_MS = 2_000;
/** A hidden tab does not poll, but looks again this often in case it was shown without the browser saying so. */
const HIDDEN_RECHECK_MS = 5_000;
const MAX_BACKOFF_MS = 15_000;
/** Closer to the bottom than this counts as "reading the latest", so new messages scroll into view. */
const NEAR_BOTTOM_PX = 96;

interface ChatViewProps {
  readonly groupId: string;
  readonly groupName: string;
  readonly meId: string;
  readonly isOrganiser: boolean;
  readonly initial: ChatSnapshot;
}

const quoteOf = (referenced: ChatMessageDto | undefined): RowModel["quote"] =>
  referenced ? { name: referenced.senderName, text: snippet(referenced.body) } : { name: null, text: "Earlier message" };

export function ChatView({ groupId, groupName, meId, isOrganiser, initial }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessageDto[]>(() => [...initial.messages]);
  const [members, setMembers] = useState<readonly string[]>(initial.members);
  const [agentWorking, setAgentWorking] = useState(initial.agentWorking);
  const [agentStatus, setAgentStatus] = useState(initial.agentStatus);
  const [plans, setPlans] = useState<readonly PlanCardDto[]>(initial.plans);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [replyTo, setReplyTo] = useState<RowModel | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [typing, setTyping] = useState(false);
  const [hasEarlier, setHasEarlier] = useState(initial.hasEarlier);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierFailed, setEarlierFailed] = useState(false);
  /** What a screen reader is told when something new arrives, instead of reading out the whole chat each time. */
  const [announcement, setAnnouncement] = useState("");

  const scrollBox = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const newestSeq = useRef(lastSeq(initial.messages));
  const tempCounter = useRef(0);
  /** Where the list was before older messages were added above it, so the reader stays on the same message. */
  const scrollAnchor = useRef<{ readonly height: number; readonly top: number } | null>(null);

  useEffect(() => {
    newestSeq.current = lastSeq(messages);
  }, [messages]);

  const applySnapshot = useCallback(
    (snapshot: ChatSnapshot) => {
      if (snapshot.messages.length > 0) {
        setMessages((held) => mergeMessages(held, snapshot.messages));
        if (!stickToBottom.current) setUnseen((count) => count + snapshot.messages.filter((message) => message.senderId !== meId).length);
      }
      const incoming = snapshot.messages.filter((message) => message.senderId !== meId).at(-1);
      if (incoming) setAnnouncement(incoming.kind === "system" ? incoming.body : `${incoming.senderName ?? "Someone"}: ${snippet(incoming.body, 160)}`);
      setMembers(snapshot.members);
      setAgentWorking(snapshot.agentWorking);
      setAgentStatus(snapshot.agentStatus);
      setPlans(snapshot.plans);
    },
    [meId],
  );

  // Asks for what is new every couple of seconds. It rests while the tab is hidden, slows down after errors, and stops for good if the group no longer knows this browser.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const controller = new AbortController();

    const schedule = (ms: number) => {
      if (!cancelled) timer = setTimeout(() => void tick(), ms);
    };

    async function tick() {
      if (document.visibilityState === "hidden") return schedule(HIDDEN_RECHECK_MS);
      try {
        const response = await fetch(`/api/groups/${groupId}/poll?after=${newestSeq.current}`, { cache: "no-store", signal: controller.signal });
        if (response.status === 401) return setSignedOut(true);
        if (!response.ok) throw new Error(`poll answered ${response.status}`);
        const snapshot = (await response.json()) as ChatSnapshot;
        if (cancelled) return;
        failures = 0;
        applySnapshot(snapshot);
        // A full page means there is more waiting, so ask again straight away.
        schedule(snapshot.messages.length >= POLL_LIMIT ? 0 : POLL_MS);
      } catch {
        if (cancelled) return;
        failures += 1;
        schedule(Math.min(POLL_MS * 2 ** failures, MAX_BACKOFF_MS));
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule(POLL_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [groupId, applySnapshot]);

  const send = useCallback(
    async (body: string, replyToId: string | null, repliesToAgent: boolean) => {
      stickToBottom.current = true;
      const tempId = `pending-${tempCounter.current++}`;
      setPending((held) => [...held, { tempId, body, replyToId, status: "sending", sentAt: Date.now(), afterSeq: newestSeq.current }]);

      const fail = (error: string) => setPending((held) => held.map((item) => (item.tempId === tempId ? { ...item, status: "failed", error } : item)));
      try {
        const result = await sendMessage(groupId, body, replyToId);
        if (!result.ok) return fail(result.error);
        setMessages((held) => mergeMessages(held, [result.message]));
        setPending((held) => held.filter((item) => item.tempId !== tempId));
        // The run starts before the answer comes back, so show the agent as working now rather than at the next poll.
        if (mentionsAgent(body) || repliesToAgent) setAgentWorking(true);
      } catch {
        fail("Couldn't reach the server");
      }
    },
    [groupId],
  );

  const shown = useMemo(() => visiblePending(pending, messages, meId), [pending, messages, meId]);

  const models = useMemo<RowModel[]>(() => {
    const byId = new Map(messages.map((message) => [message.id, message]));
    const confirmed = messages.map<RowModel>((message) => ({
      key: message.id,
      kind: message.kind,
      senderId: message.senderId,
      senderName: message.senderName,
      body: message.body,
      at: new Date(message.at),
      planId: message.planId,
      quote: message.replyToId ? quoteOf(byId.get(message.replyToId)) : null,
      status: "sent",
      replyId: message.kind === "agent" ? message.id : null,
    }));
    const unconfirmed = shown.map<RowModel>((item) => ({
      key: item.tempId,
      kind: "human",
      senderId: meId,
      senderName: "You",
      body: item.body,
      at: new Date(item.sentAt),
      planId: null,
      quote: item.replyToId ? quoteOf(byId.get(item.replyToId)) : null,
      status: item.status,
      error: item.error,
      replyId: null,
    }));
    return [...confirmed, ...unconfirmed];
  }, [messages, shown, meId]);

  const laid = layoutMessages(models, new Date());

  // Older messages are added above what the reader is looking at, so the scroll position moves down by what was added.
  useLayoutEffect(() => {
    const box = scrollBox.current;
    const anchor = scrollAnchor.current;
    if (!box || !anchor) return;
    box.scrollTop = anchor.top + (box.scrollHeight - anchor.height);
    scrollAnchor.current = null;
  }, [messages]);

  // Keeps the newest message in view while the person is reading the latest, and leaves them where they are when they have scrolled up.
  useLayoutEffect(() => {
    const box = scrollBox.current;
    if (box && stickToBottom.current) box.scrollTop = box.scrollHeight;
  }, [models.length, agentWorking]);

  function onScroll() {
    const box = scrollBox.current;
    if (!box) return;
    stickToBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < NEAR_BOTTOM_PX;
    if (stickToBottom.current) setUnseen(0);
  }

  async function loadEarlier() {
    const box = scrollBox.current;
    const oldest = messages[0]?.seq;
    if (!box || oldest === undefined || loadingEarlier) return;
    setLoadingEarlier(true);
    setEarlierFailed(false);
    try {
      const response = await fetch(`/api/groups/${groupId}/earlier?before=${oldest}`, { cache: "no-store" });
      if (response.status === 401) return setSignedOut(true);
      if (!response.ok) throw new Error(`earlier answered ${response.status}`);
      const page = (await response.json()) as EarlierPage;
      scrollAnchor.current = { height: box.scrollHeight, top: box.scrollTop };
      stickToBottom.current = false;
      setMessages((held) => mergeMessages(held, page.messages));
      setHasEarlier(page.hasEarlier);
    } catch {
      setEarlierFailed(true);
    } finally {
      setLoadingEarlier(false);
    }
  }

  function jumpToLatest() {
    const box = scrollBox.current;
    if (!box) return;
    stickToBottom.current = true;
    box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
    setUnseen(0);
  }

  function retry(model: RowModel) {
    const failed = pending.find((item) => item.tempId === model.key);
    if (!failed) return;
    setPending((held) => held.filter((item) => item.tempId !== model.key));
    void send(failed.body, failed.replyToId, false);
  }

  const isEmpty = models.length === 0;
  // The server gives the person's own next step only on the group's newest open plan, so that is the plan the sheet is about.
  const decidingOn = plans.find((plan) => plan.mine) ?? null;
  // When the sheet is not about the current plan (it is booked, or the person is not in it), a strip keeps it one tap away.
  const current = latestPlan(plans);

  return (
    <>
      <header className="sticky top-0 z-10 flex items-center gap-1 border-b border-border bg-card py-1.5 pr-4 pl-2 text-foreground">
        <Link href="/" aria-label="All trips" className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-muted">
          <ArrowLeft className="size-5" />
        </Link>
        <Link href={`/g/${groupId}/info`} className="flex min-w-0 flex-1 items-center gap-3 py-1.5">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg leading-tight font-extrabold">{groupName}</h1>
            <p className="truncate text-xs text-muted-foreground">{members.length > 0 ? members.join(", ") : "Tap for group info"}</p>
          </div>
          <AvatarStack people={members.map((name) => ({ name }))} max={3} size={28} />
        </Link>
        <PersonasSheet groupId={groupId} />
      </header>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <SaveLinkPrompt groupId={groupId} />

      {current && current.status !== "expired" && !decidingOn ? <PlanStrip groupId={groupId} plan={current} /> : null}

      <div ref={scrollBox} onScroll={onScroll} className="relative flex-1 overflow-y-auto bg-background px-4 pt-2 pb-4">
        {hasEarlier ? (
          <div className="flex justify-center pt-1 pb-1">
            <button
              type="button"
              onClick={() => void loadEarlier()}
              disabled={loadingEarlier}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-card px-4 text-sm font-semibold text-link shadow-soft disabled:opacity-60"
            >
              {loadingEarlier ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
              {earlierFailed ? "Couldn’t load. Try again" : "Load earlier messages"}
            </button>
          </div>
        ) : null}

        {isEmpty ? (
          <div className="mx-auto mt-10 flex max-w-xs flex-col items-center gap-3 rounded-3xl bg-card px-5 py-6 text-center shadow-soft">
            <AgentAvatar size={48} />
            <h2 className="font-extrabold">Say hi to your group</h2>
            <p className="text-sm text-muted-foreground">
              When you&apos;re ready to plan a trip, mention <span className="font-semibold text-link">@trippy</span>, like &ldquo;@trippy plan Bangkok, 11 to 13 Dec&rdquo;.
            </p>
            <p className="text-sm text-muted-foreground">Then everyone agrees and approves their own amount. Nobody is charged unless everyone is in.</p>
            {isOrganiser ? (
              <Link href={`/g/${groupId}/info`} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                <UserPlus className="size-4" />
                Invite friends
              </Link>
            ) : null}
          </div>
        ) : null}

        {laid.map(({ item, dayLabel, startsRun }) => (
          <div key={item.key}>
            {dayLabel ? (
              <div className="mt-4 flex items-center gap-3" role="separator">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground" suppressHydrationWarning>
                  {dayLabel}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            <MessageRow
              groupId={groupId}
              model={item}
              mine={item.senderId === meId}
              startsRun={startsRun}
              plans={plans}
              onReply={setReplyTo}
              onRetry={retry}
            />
          </div>
        ))}

        {agentWorking ? (
          <div className="mt-4 flex items-start gap-3" role="status">
            <AgentAvatar size={34} />
            <div className="min-w-0 flex-1">
              <p className="mb-0.5 text-xs font-bold text-success">Trippy</p>
              <p className="text-[15px] leading-snug text-muted-foreground">
                {agentStatus ?? "Thinking"}
                <span className="ml-1 inline-flex gap-0.5" aria-hidden="true">
                  <span className="size-1 animate-pulse rounded-full bg-muted-foreground" />
                  <span className="size-1 animate-pulse rounded-full bg-muted-foreground [animation-delay:200ms]" />
                  <span className="size-1 animate-pulse rounded-full bg-muted-foreground [animation-delay:400ms]" />
                </span>
              </p>
            </div>
          </div>
        ) : null}

        {signedOut ? (
          <p role="alert" className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
            This browser is no longer signed in to the group. Open your invite link to rejoin.
          </p>
        ) : null}

        {unseen > 0 ? (
          <button
            type="button"
            onClick={jumpToLatest}
            className="sticky bottom-2 left-full mt-2 -mr-1 ml-auto flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-lift"
          >
            <ArrowDown className="size-3.5" />
            {unseen} new
          </button>
        ) : null}
      </div>

      {decidingOn?.mine && !signedOut ? <ActionSheet groupId={groupId} plan={decidingOn} mine={decidingOn.mine} onChangesSent={(asked) => asked && setAgentWorking(true)} folded={typing} /> : null}

      <Composer
        disabled={signedOut}
        onFocusChange={setTyping}
        replyingTo={replyTo ? { name: replyTo.senderName, text: snippet(replyTo.body) } : null}
        onCancelReply={() => setReplyTo(null)}
        onSend={(body) => {
          void send(body, replyTo?.replyId ?? null, replyTo?.kind === "agent");
          setReplyTo(null);
        }}
      />
    </>
  );
}
