"use client";

import { AtSign, SendHorizontal, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { MAX_MESSAGE_LENGTH } from "@/domain/group/types";
import { cn } from "@/lib/utils";

const MAX_HEIGHT_PX = 120;
const MENTION = "@agent ";

interface ComposerProps {
  readonly onSend: (body: string) => void;
  readonly replyingTo: { readonly name: string | null; readonly text: string } | null;
  readonly onCancelReply: () => void;
  readonly disabled?: boolean;
}

/** The bar at the bottom: a box that grows as you type, a shortcut for @agent, and a round send button. */
export function Composer({ onSend, replyingTo, onCancelReply, disabled = false }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const canSend = !disabled && draft.trim().length > 0;

  function grow() {
    const element = box.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }

  function submit() {
    if (!canSend) return;
    onSend(draft.trim());
    setDraft("");
    // The box has not re-rendered yet, so shrink it once it has.
    requestAnimationFrame(grow);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends and Shift+Enter starts a new line, like WhatsApp Web. A key that is confirming a character (an IME) is left alone.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }

  function insertMention() {
    const element = box.current;
    const start = element?.selectionStart ?? draft.length;
    const end = element?.selectionEnd ?? draft.length;
    // A space first, unless the mention would start the message or follow a space, so it counts as a word of its own.
    const needsSpace = start > 0 && !/\s/.test(draft[start - 1]);
    const inserted = `${needsSpace ? " " : ""}${MENTION}`;
    const next = draft.slice(0, start) + inserted + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + inserted.length, start + inserted.length);
      grow();
    });
  }

  return (
    <div className="border-t border-border bg-background px-3 pt-2 pb-3">
      {replyingTo ? (
        <div className="mb-2 flex items-start gap-2 rounded-lg border-l-4 border-primary bg-muted px-3 py-1.5 text-xs">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-primary">Replying to {replyingTo.name ?? "message"}</p>
            <p className="truncate text-muted-foreground">{replyingTo.text}</p>
          </div>
          <button type="button" onClick={onCancelReply} aria-label="Cancel reply" className="rounded-full p-1 text-muted-foreground hover:bg-black/5">
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <div className="flex min-w-0 flex-1 items-end rounded-3xl border border-input bg-card px-3 py-1.5">
          <textarea
            ref={box}
            value={draft}
            rows={1}
            maxLength={MAX_MESSAGE_LENGTH}
            enterKeyHint="send"
            placeholder={disabled ? "You can't write in this group" : "Message"}
            aria-label="Message"
            disabled={disabled}
            onChange={(event) => {
              setDraft(event.target.value);
              grow();
            }}
            onKeyDown={onKeyDown}
            className="max-h-[120px] min-w-0 flex-1 resize-none bg-transparent py-1 text-[15px] leading-snug outline-none placeholder:text-muted-foreground/70"
          />
          <button
            type="button"
            onClick={insertMention}
            disabled={disabled}
            aria-label="Mention the trip agent"
            className="mb-0.5 ml-1 inline-flex shrink-0 items-center gap-0.5 rounded-full bg-accent px-2 py-1 text-xs font-semibold text-accent-foreground disabled:opacity-50"
          >
            <AtSign className="size-3" />
            agent
          </button>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          aria-label="Send"
          className={cn("flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity", !canSend && "opacity-50")}
        >
          <SendHorizontal className="size-5" />
        </button>
      </div>
    </div>
  );
}
