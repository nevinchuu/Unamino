import { Avatar } from "@/components/avatar";
import { commitmentLabel, commitmentOf, isCommitted, type CommitmentStep } from "@/lib/commitment";
import type { CardPerson } from "@/lib/plan-card";
import { cn } from "@/lib/utils";

interface StripProps {
  readonly people: readonly CardPerson[];
  /** Agreeing turns the rings green first; once everyone has agreed they start again and turn green on approving. */
  readonly step: CommitmentStep;
}

const wordFor = (step: CommitmentStep, person: CardPerson): string => commitmentLabel(commitmentOf(step, person));

/** One small avatar per person, with a green ring and a tick once they have done the current step. The words are in the open panel, and read aloud here. */
export function ApprovalStrip({ people, step }: StripProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 pr-1">
      <span className="sr-only">{people.map((person) => `${person.isMe ? "You" : person.name}: ${wordFor(step, person).toLowerCase()}`).join(". ")}</span>
      {people.map((person) => (
        <Avatar key={person.name} name={person.name} size={22} commitment={commitmentOf(step, person)} />
      ))}
    </div>
  );
}

/** Each person and where they stand on the current step, one line each, for when the panel is open. */
export function ApprovalList({ people, step }: StripProps) {
  return (
    <ul className="flex flex-col gap-1.5 rounded-2xl bg-background px-3.5 py-3 text-[13px]">
      {people.map((person) => {
        const done = isCommitted(commitmentOf(step, person));
        return (
          <li key={person.name} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">{person.isMe ? "You" : person.name}</span>
            <span className={cn(done ? "font-bold text-success" : "text-muted-foreground")}>{wordFor(step, person)}</span>
          </li>
        );
      })}
    </ul>
  );
}
