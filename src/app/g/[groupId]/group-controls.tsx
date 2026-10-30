"use client";

import { KeyRound, LogOut, MoreVertical, Trash2, UserMinus, UserCog, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/avatar";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { LinkActions } from "@/components/link-actions";
import { Dialog } from "@base-ui/react/dialog";
import { deleteGroup, issueAccessLink, leaveGroup, makeGroupAdmin, removeMember } from "./manage-actions";

export interface Participant {
  readonly id: string;
  readonly name: string;
  readonly isMe: boolean;
  readonly isAdmin: boolean;
  /** A simulated friend a judge added. It has no access link to send. */
  readonly isTestPersona: boolean;
}

/** The people in the group. The admin gets a menu on everyone else, to hand over the role or remove them. */
export function ParticipantList({ groupId, people, viewerIsAdmin }: { readonly groupId: string; readonly people: readonly Participant[]; readonly viewerIsAdmin: boolean }) {
  return (
    <ul>
      {people.map((person) => (
        <li key={person.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
          <Avatar name={person.name} size={40} />
          <span className="min-w-0 flex-1 truncate font-medium">
            {person.name}
            {person.isMe ? <span className="font-normal text-muted-foreground"> (You)</span> : null}
          </span>
          {person.isTestPersona ? <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">Test persona</span> : null}
          {person.isAdmin ? <span className="rounded-full border border-success px-2 py-0.5 text-xs font-medium text-success">Group admin</span> : null}
          {viewerIsAdmin && !person.isMe ? <ParticipantMenu groupId={groupId} person={person} /> : null}
        </li>
      ))}
    </ul>
  );
}

function ParticipantMenu({ groupId, person }: { readonly groupId: string; readonly person: Participant }) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [confirming, setConfirming] = useState<"remove" | "admin" | "link" | null>(null);
  const [resetLink, setResetLink] = useState(true);
  /** The new access link for this person, shown once to the admin to pass on. */
  const [issued, setIssued] = useState<string | null>(null);

  return (
    <>
      <button type="button" aria-label={`Options for ${person.name}`} onClick={() => setMenu(true)} className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
        <MoreVertical className="size-5" />
      </button>

      <Dialog.Root open={menu} onOpenChange={setMenu}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-[430px] rounded-t-2xl bg-background px-3 pt-4 pb-6 shadow-xl outline-none">
            <Dialog.Title className="px-3 pb-2 text-base font-semibold">{person.name}</Dialog.Title>
            <Dialog.Description className="sr-only">What the group admin can do for {person.name}</Dialog.Description>
            {person.isTestPersona ? null : (
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  setConfirming("admin");
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left font-medium hover:bg-muted"
              >
                <UserCog className="size-5 text-muted-foreground" />
                Make group admin
              </button>
            )}
            {person.isTestPersona ? null : (
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  setConfirming("link");
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left font-medium hover:bg-muted"
              >
                <KeyRound className="size-5 text-muted-foreground" />
                Send new access link
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMenu(false);
                setConfirming("remove");
              }}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left font-medium text-destructive hover:bg-muted"
            >
              <UserMinus className="size-5" />
              Remove from group
            </button>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmSheet
        open={confirming === "admin"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`Make ${person.name} the group admin?`}
        description="There is one admin at a time. You become an ordinary member and can no longer remove people or delete the group."
        confirmLabel="Make admin"
        onConfirm={async () => {
          const result = await makeGroupAdmin(groupId, person.id);
          if (!result.ok) return result.error;
          router.refresh();
          return null;
        }}
      />

      <ConfirmSheet
        open={confirming === "link"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`New access link for ${person.name}?`}
        description={`${person.name} is signed out of their current phone and browser, and you get a link to send them yourself. The group will see that you did it.`}
        confirmLabel="Make link"
        onConfirm={async () => {
          const result = await issueAccessLink(groupId, person.id);
          if (!result.ok) return result.error;
          setIssued(result.accessToken ?? null);
          return null;
        }}
      />

      <Dialog.Root open={issued !== null} onOpenChange={(open) => !open && setIssued(null)}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[90dvh] w-full max-w-[430px] overflow-y-auto rounded-t-2xl bg-background px-5 pt-5 pb-6 shadow-xl outline-none">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Dialog.Title className="text-lg font-semibold">Send this to {person.name}</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-muted-foreground">It signs {person.name} back in, and it is shown only once.</Dialog.Description>
              </div>
              <Dialog.Close aria-label="Close" className="-mt-1 -mr-1 rounded-full p-3 text-muted-foreground hover:bg-muted">
                <X className="size-5" />
              </Dialog.Close>
            </div>
            {issued ? <LinkActions path={`/back/${issued}`} shareTitle={`${person.name}: access link`} shareLabel="Send" /> : null}
            <p role="note" className="mt-3 text-xs text-muted-foreground">
              Send it only to {person.name}. Anyone who has it can act as {person.name} until {person.name} makes their own new link in Group info.
            </p>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmSheet
        open={confirming === "remove"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`Remove ${person.name}?`}
        description="They leave the chat and can't see it any more. If the group is deciding on a plan, the plan ends and every card hold is released."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          const result = await removeMember(groupId, person.id, resetLink);
          if (!result.ok) return result.error;
          router.refresh();
          return null;
        }}
      >
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input type="checkbox" checked={resetLink} onChange={(event) => setResetLink(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-primary" />
          <span>Also make a new invite link, so {person.name} can&apos;t rejoin with the old one. You&apos;ll need to share the new link.</span>
        </label>
      </ConfirmSheet>
    </>
  );
}

/** Exit, for everyone but the admin, and delete, for the admin only. */
export function GroupDangerZone({ groupId, groupName, isAdmin }: { readonly groupId: string; readonly groupName: string; readonly isAdmin: boolean }) {
  const router = useRouter();
  const [exiting, setExiting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState("");

  return (
    <section aria-label="Leave or delete" className="overflow-hidden rounded-xl bg-card shadow-sm">
      {isAdmin ? (
        <p className="px-4 pt-3 text-xs text-muted-foreground">You&apos;re the group admin. To exit, make someone else the admin first (tap the ⋮ next to their name), or delete the group.</p>
      ) : (
        <button type="button" onClick={() => setExiting(true)} className="flex min-h-14 w-full items-center gap-3 px-4 text-left font-medium text-destructive hover:bg-muted">
          <LogOut className="size-5" />
          Exit group
        </button>
      )}
      {isAdmin ? (
        <button type="button" onClick={() => setDeleting(true)} className="flex min-h-14 w-full items-center gap-3 px-4 text-left font-medium text-destructive hover:bg-muted">
          <Trash2 className="size-5" />
          Delete group
        </button>
      ) : null}

      <ConfirmSheet
        open={exiting}
        onOpenChange={setExiting}
        title={`Exit ${groupName}?`}
        description="You won't get new messages and the group leaves your list. If it is deciding on a plan, the plan ends and every card hold is released. You can rejoin with the invite link."
        confirmLabel="Exit group"
        destructive
        onConfirm={async () => {
          const result = await leaveGroup(groupId);
          if (!result.ok) return result.error;
          router.replace("/");
          return null;
        }}
      />

      <ConfirmSheet
        open={deleting}
        onOpenChange={(open) => {
          setDeleting(open);
          if (!open) setTyped("");
        }}
        title={`Delete ${groupName}?`}
        description="This deletes the chat, the plans and everyone's traveller details, for everyone, and can't be undone. A trip that is already booked can't be deleted."
        confirmLabel="Delete for everyone"
        destructive
        ready={typed.trim() === groupName}
        onConfirm={async () => {
          const result = await deleteGroup(groupId, typed);
          if (!result.ok) return result.error;
          router.replace("/");
          return null;
        }}
      >
        <label className="block text-xs font-medium text-muted-foreground" htmlFor="delete-confirm">
          Type the group name to confirm
        </label>
        <input
          id="delete-confirm"
          value={typed}
          autoComplete="off"
          onChange={(event) => setTyped(event.target.value)}
          placeholder={groupName}
          className="mt-1 h-12 w-full rounded-lg border border-border bg-background px-3 text-base outline-none focus:border-primary"
        />
      </ConfirmSheet>
    </section>
  );
}
