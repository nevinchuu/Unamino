import { Avatar } from "@/components/avatar";
import { commitmentLabel, commitmentOf } from "@/lib/commitment";
import type { CardPerson } from "@/lib/plan-card";
import { cn } from "@/lib/utils";

const wordFor = (person: CardPerson): string => commitmentLabel(commitmentOf(person));

/** One small avatar per person, with a green ring and a tick once they have approved. The words are in the open panel, and read aloud here. */
export function ApprovalStrip({ people }: { readonly people: readonly CardPerson[] }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 pr-1">
      <span className="sr-only">{people.map((person) => `${person.isMe ? "You" : person.name}: ${wordFor(person).toLowerCase()}`).join(". ")}</span>
      {people.map((person) => (
        <Avatar key={person.name} name={person.name} size={22} commitment={commitmentOf(person)} />
      ))}
    </div>
  );
}

/** Each person and where they stand, one line each, for when the panel is open. */
export function ApprovalList({ people }: { readonly people: readonly CardPerson[] }) {
  return (
    <ul className="flex flex-col gap-1.5 rounded-2xl bg-background px-3.5 py-3 text-[13px]">
      {people.map((person) => {
        const approved = commitmentOf(person) === "approved";
        return (
          <li key={person.name} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">{person.isMe ? "You" : person.name}</span>
            <span className={cn(approved ? "font-bold text-success" : "text-muted-foreground")}>{wordFor(person)}</span>
          </li>
        );
      })}
    </ul>
  );
}
