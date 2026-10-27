"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { MAX_NAME_LENGTH } from "@/domain/group/types";
import type { FormState } from "@/server/forms";
import { joinGroup } from "./actions";

const INITIAL: FormState = {};

export function JoinForm({ joinToken }: { readonly joinToken: string }) {
  const [state, formAction, pending] = useActionState(joinGroup.bind(null, joinToken), INITIAL);

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <TextField
        label="Your name"
        name="yourName"
        defaultValue={state.values?.yourName ?? ""}
        placeholder="What your friends call you"
        maxLength={MAX_NAME_LENGTH * 2}
        autoComplete="given-name"
        autoFocus
        required
        error={state.fieldErrors?.yourName}
      />
      {state.message ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="h-12 w-full rounded-full text-base font-semibold">
        {pending ? <Loader2 className="size-5 animate-spin" /> : "Join group"}
      </Button>
    </form>
  );
}
