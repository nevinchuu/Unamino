"use client";

import { Check, Loader2 } from "lucide-react";
import { useActionState, useState } from "react";
import { Avatar } from "@/components/avatar";
import { TextField } from "@/components/text-field";
import { MAX_NAME_LENGTH } from "@/domain/group/types";
import type { FormState } from "@/server/forms";
import { createGroup } from "./actions";

const INITIAL: FormState = {};

export function CreateGroupForm({ currency }: { readonly currency: string }) {
  const [state, formAction, pending] = useActionState(createGroup, INITIAL);
  // The avatar follows the name as it is typed, like the picture slot in a new WhatsApp group.
  const [groupName, setGroupName] = useState(state.values?.groupName ?? "");

  return (
    <form action={formAction} className="flex flex-1 flex-col gap-6 px-6 pt-8 pb-28">
      <div className="flex justify-center">
        <Avatar name={groupName.trim() || "?"} size={96} />
      </div>

      <div className="flex flex-col gap-2">
        <TextField
          label="Group name"
          name="groupName"
          value={groupName}
          onChange={(event) => setGroupName(event.target.value)}
          placeholder="Bangkok weekend"
          maxLength={MAX_NAME_LENGTH * 2}
          autoComplete="off"
          autoFocus
          required
          error={state.fieldErrors?.groupName}
        />
        <TextField
          label="Your name"
          name="yourName"
          defaultValue={state.values?.yourName ?? ""}
          placeholder="What your friends call you"
          maxLength={MAX_NAME_LENGTH * 2}
          autoComplete="given-name"
          required
          error={state.fieldErrors?.yourName}
        />
      </div>

      <p className="text-sm text-muted-foreground">Everyone pays in {currency} for now. Nobody is charged unless everyone has approved.</p>
      {state.message ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        aria-label="Create group"
        className="fixed right-[max(1.5rem,calc(50vw-215px+1.5rem))] bottom-6 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95 disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-6 animate-spin" /> : <Check className="size-6" />}
      </button>
    </form>
  );
}
