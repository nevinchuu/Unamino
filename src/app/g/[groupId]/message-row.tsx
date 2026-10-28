import { Clock, CornerUpLeft } from "lucide-react";
import { AgentAvatar, Avatar } from "@/components/avatar";
import { splitAgentMentions } from "@/domain/group/mention";
import { avatarColour } from "@/lib/avatar";
import { clockTime } from "@/lib/chat-format";
import type { CardPlan } from "@/lib/plan-card";
import { cn } from "@/lib/utils";
import { PlanCard } from "./plan-card";

/** Everything a row needs, whether the message is confirmed, still being sent, or failed. */
export interface RowModel {
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

interface MessageRowProps {
  readonly groupId: string;
  readonly model: RowModel;
  readonly mine: boolean;
  readonly startsRun: boolean;
  readonly plans: readonly CardPlan[];
  readonly onReply: (model: RowModel) => void;
  readonly onRetry: (model: RowModel) => void;
}

const AVATAR_SIZE = 34;

function Words({ body }: { readonly body: string }) {
  return (
    <>
      {splitAgentMentions(body).map((part, index) =>
        part.isMention ? (
          <span key={index} className="font-semibold text-link">
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** One message as a flat row: a picture and a name on the left, the words beside them. Messages from the same person in a row share one picture. */
export function MessageRow({ groupId, model, mine, startsRun, plans, onReply, onRetry }: MessageRowProps) {
  if (model.kind === "system") {
    return (
      <div className="my-3 flex justify-center">
        <span className="max-w-[85%] rounded-full bg-secondary px-3 py-1 text-center text-xs text-muted-foreground">{model.body}</span>
      </div>
    );
  }

  const isAgent = model.kind === "agent";
  const name = mine ? "You" : (model.senderName ?? "");
  return (
    <div className={cn("flex items-start gap-3", startsRun ? "mt-4" : "mt-1", model.status === "sending" && "opacity-70")}>
      {startsRun ? isAgent ? <AgentAvatar size={AVATAR_SIZE} /> : <Avatar name={model.senderName ?? name} size={AVATAR_SIZE} /> : <span className="shrink-0" style={{ width: AVATAR_SIZE }} />}

      <div className="min-w-0 flex-1">
        {startsRun ? (
          <p className="mb-0.5 flex items-baseline gap-2 text-xs">
            <span className={cn("font-bold", isAgent && "text-success")} style={isAgent ? undefined : { color: avatarColour(model.senderName ?? name) }}>
              {name}
            </span>
            {/* Shown in the reader's own time zone, which the server cannot know, so the first draw may differ. */}
            <time dateTime={model.at.toISOString()} className="text-[11px] text-muted-foreground" suppressHydrationWarning>
              {clockTime(model.at)}
            </time>
            {model.status === "sending" ? <Clock className="size-3 text-muted-foreground" aria-label="Sending" /> : null}
          </p>
        ) : null}

        {model.quote ? (
          <blockquote className="my-1 rounded-lg border-l-4 border-link/50 bg-secondary px-2.5 py-1.5 text-xs">
            {model.quote.name ? <p className="font-semibold text-link">{model.quote.name}</p> : null}
            <p className="line-clamp-2 text-muted-foreground">{model.quote.text}</p>
          </blockquote>
        ) : null}

        <p className="text-[15px] leading-snug break-words whitespace-pre-wrap">
          <Words body={model.body} />
        </p>

        {model.planId ? <PlanCard groupId={groupId} planId={model.planId} plans={plans} /> : null}

        {model.status === "failed" ? (
          <button type="button" onClick={() => onRetry(model)} className="mt-1 block text-left text-xs font-medium text-destructive">
            {model.error ?? "Not sent"}. Tap to try again
          </button>
        ) : null}

        {model.replyId ? (
          <button type="button" onClick={() => onReply(model)} className="mt-1 inline-flex min-h-8 items-center gap-1 text-xs font-medium text-link">
            <CornerUpLeft className="size-3" />
            Reply
          </button>
        ) : null}
      </div>
    </div>
  );
}
