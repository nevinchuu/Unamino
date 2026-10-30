"use client";

import { Dialog } from "@base-ui/react/dialog";
import { LogOut, MoreVertical, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { deleteGroup, leaveGroup } from "./g/[groupId]/manage-actions";

/**
 * The three dots on a trip card. A member can exit the trip; the admin can delete it for everyone. It sits next to the
 * card's link, not inside it, because a button inside a link does neither job well.
 */
export function TripMenu({ groupId, name, isAdmin }: { readonly groupId: string; readonly name: string; readonly isAdmin: boolean }) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");

  const verb = isAdmin ? "Delete trip" : "Exit trip";
  return (
    <>
      <button type="button" aria-label={`Options for ${name}`} onClick={() => setMenu(true)} className="absolute top-1 right-1 flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
        <MoreVertical className="size-5" />
      </button>

      <Dialog.Root open={menu} onOpenChange={setMenu}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-[430px] rounded-t-2xl bg-background px-3 pt-4 pb-6 shadow-xl outline-none">
            <Dialog.Title className="truncate px-3 pb-2 text-base font-semibold">{name}</Dialog.Title>
            <Dialog.Description className="sr-only">What you can do with this trip</Dialog.Description>
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                setConfirming(true);
              }}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left font-medium text-destructive hover:bg-muted"
            >
              {isAdmin ? <Trash2 className="size-5" /> : <LogOut className="size-5" />}
              {verb}
            </button>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      {isAdmin ? (
        <ConfirmSheet
          open={confirming}
          onOpenChange={(open) => {
            setConfirming(open);
            if (!open) setTyped("");
          }}
          title={`Delete ${name}?`}
          description="This deletes the chat, the plans and everyone's traveller details, for everyone, and can't be undone. A trip that is already booked can't be deleted."
          confirmLabel="Delete for everyone"
          destructive
          ready={typed.trim() === name}
          onConfirm={async () => {
            const result = await deleteGroup(groupId, typed);
            if (!result.ok) return result.error;
            router.refresh();
            return null;
          }}
        >
          <label className="block text-xs font-medium text-muted-foreground" htmlFor={`delete-${groupId}`}>
            Type the trip name to confirm
          </label>
          <input
            id={`delete-${groupId}`}
            value={typed}
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
            placeholder={name}
            className="mt-1 h-12 w-full rounded-lg border border-border bg-background px-3 text-base outline-none focus:border-primary"
          />
        </ConfirmSheet>
      ) : (
        <ConfirmSheet
          open={confirming}
          onOpenChange={setConfirming}
          title={`Exit ${name}?`}
          description="You won't get new messages and the trip leaves your list. If the group is deciding on a plan, the plan ends and every card hold is released. You can rejoin with the invite link."
          confirmLabel="Exit trip"
          destructive
          onConfirm={async () => {
            const result = await leaveGroup(groupId);
            if (!result.ok) return result.error;
            router.refresh();
            return null;
          }}
        />
      )}
    </>
  );
}
