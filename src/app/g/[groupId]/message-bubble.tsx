import { Clock, CornerUpLeft } from "lucide-react";
import { AgentAvatar, Avatar } from "@/components/avatar";
import { splitAgentMentions } from "@/domain/group/mention";
import { avatarColour } from "@/lib/avatar";
import { clockTime } from "@/lib/chat-format";
import type { LatestPlan } from "@/lib/plan-card";
import { cn } from "@/lib/utils";
import { PlanCard } from "./plan-card";

/** Everything a bubble needs, whether the message is confirmed, still being sent, or failed. */
export interface BubbleModel {
  readonly key: string;
  readonly kind: "human" | "agent" | "system";
  readonly senderId: string | null;
  readonly senderName: string | null;
  readonly body: string;
  readonly at: Date;
  readonly planId: string | null;
  readonly quote: { readonly name: string | null; readonly text: string } | null;
  readonly status: "sent" | "sending" | "failed";
  readonly error?: string;
  /** Set where the person can reply to this message. */
  readonly replyId: string | null;
}

interface MessageBubbleProps {
  readonly model: BubbleModel;
  readonly mine: boolean;
  readonly startsRun: boolean;
  readonly latestPlan: LatestPlan | null;
  readonly onReply: (model: BubbleModel) => void;
  readonly onRetry: (model: BubbleModel) => void;
}

const AVATAR_SIZE = 32;

function Words({ body }: { readonly body: string }) {
  return (
    <>
      {splitAgentMentions(body).map((part, index) =>
        part.isMention ? (
          <span key={index} className="font-semibold text-primary">
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

export function MessageBubble({ model, mine, startsRun, latestPlan, onReply, onRetry }: MessageBubbleProps) {
  if (model.kind === "system") {
    return (
      <div className="my-2 flex justify-center">
        <span className="max-w-[85%] rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">{model.body}</span>
      </div>
    );
  }

  const isAgent = model.kind === "agent";
  const name = model.senderName ?? "";
  return (
    <div className={cn("flex items-end gap-2", mine ? "justify-end" : "justify-start", startsRun ? "mt-3" : "mt-0.5")}>
      {!mine ? (
        startsRun ? (
          isAgent ? (
            <AgentAvatar size={AVATAR_SIZE} />
          ) : (
            <Avatar name={name} size={AVATAR_SIZE} />
          )
        ) : (
          <span className="shrink-0" style={{ width: AVATAR_SIZE }} />
        )
      ) : null}

      <div
        className={cn(
          "max-w-[78%] min-w-0 rounded-2xl px-3 py-1.5 shadow-sm",
          mine ? "bg-accent" : "bg-card",
          startsRun && (mine ? "rounded-tr-md" : "rounded-tl-md"),
          model.status === "sending" && "opacity-70",
        )}
      >
        {startsRun && !mine ? (
          <p className="text-xs font-semibold" style={{ color: isAgent ? "var(--primary)" : avatarColour(name) }}>
            {name}
          </p>
        ) : null}

        {model.quote ? (
          <blockquote className="my-1 rounded-md border-l-4 border-primary/60 bg-black/5 px-2 py-1 text-xs">
            {model.quote.name ? <p className="font-semibold text-primary">{model.quote.name}</p> : null}
            <p className="line-clamp-2 text-muted-foreground">{model.quote.text}</p>
          </blockquote>
        ) : null}

        <p className="text-[15px] leading-snug break-words whitespace-pre-wrap">
          <Words body={model.body} />
          <span className="float-right mt-1.5 ml-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            {model.status === "sending" ? <Clock className="size-3" aria-label="Sending" /> : null}
            {/* Shown in the reader's own time zone, which the server cannot know, so the first draw may differ. */}
            <time dateTime={model.at.toISOString()} suppressHydrationWarning>
              {clockTime(model.at)}
            </time>
          </span>
        </p>

        {model.planId ? <PlanCard planId={model.planId} latest={latestPlan} /> : null}

        {model.status === "failed" ? (
          <button type="button" onClick={() => onRetry(model)} className="mt-1 block text-left text-xs font-medium text-destructive">
            {model.error ?? "Not sent"}. Tap to try again
          </button>
        ) : null}

        {model.replyId ? (
          <button type="button" onClick={() => onReply(model)} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary">
            <CornerUpLeft className="size-3" />
            Reply
          </button>
        ) : null}
      </div>
    </div>
  );
}
