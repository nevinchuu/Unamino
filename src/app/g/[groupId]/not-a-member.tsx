import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { AppBar } from "@/components/screen";

/** What anyone sees who is not in the group. The same for a group that exists and one that does not. */
export function NotAMember() {
  return (
    <>
      <AppBar title="Group" />
      <main className="flex flex-1 flex-col items-center gap-3 px-8 pt-20 text-center">
        <Avatar name="?" size={96} />
        <h2 className="mt-2 text-xl font-semibold">You&apos;re not in this group</h2>
        <p className="text-muted-foreground">Open the invite link someone sent you to join, or your access link if you made one.</p>
        <Link href="/new" className="mt-4 text-sm font-medium text-primary">
          Start your own group
        </Link>
      </main>
    </>
  );
}
