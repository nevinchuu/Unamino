import { Check, Sparkles } from "lucide-react";
import { avatarColour, initialsOf } from "@/lib/avatar";
import { splitForStack } from "@/lib/avatar-stack";
import { commitmentLabel, type Commitment } from "@/lib/commitment";
import { cn } from "@/lib/utils";

interface AvatarProps {
  /** The person or group the avatar stands for. Its first letters and its colour come from this. */
  readonly name: string;
  /** Pixels. Letters scale with it. */
  readonly size?: number;
  /** A small green dot at the bottom right: this person has agreed or put their card on hold. */
  readonly dot?: boolean;
  /** How far this person has got towards committing, drawn as a ring: dashed grey, amber, solid amber, and green with a tick once they are in. */
  readonly commitment?: Commitment | null;
  readonly className?: string;
}

const RING: Readonly<Record<Commitment, string>> = {
  not_yet: "border-dashed border-muted-foreground/40",
  agreed: "border-pending-foreground/45",
  approved: "border-pending-foreground",
  in: "border-success",
};

/** A round coloured circle with initials, the way a chat shows someone who has no photo. */
export function Avatar({ name, size = 40, dot = false, commitment = null, className }: AvatarProps) {
  return (
    <span aria-hidden="true" className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      {commitment ? <span className={cn("absolute -inset-[3px] rounded-full border-2", RING[commitment])} /> : null}
      <span
        className="inline-flex size-full items-center justify-center rounded-full font-semibold text-white select-none"
        style={{ backgroundColor: avatarColour(name), fontSize: Math.round(size * 0.4) }}
      >
        {initialsOf(name)}
      </span>
      {dot ? (
        <span className="absolute -right-0.5 -bottom-0.5 rounded-full border-[1.5px] border-card bg-presence" style={{ width: Math.max(8, size * 0.3), height: Math.max(8, size * 0.3) }} />
      ) : null}
      {commitment === "in" ? (
        <span className="absolute -right-1 -bottom-1 flex items-center justify-center rounded-full border-[1.5px] border-card bg-success text-primary-foreground" style={{ width: Math.max(10, size * 0.38), height: Math.max(10, size * 0.38) }}>
          <Check style={{ width: "70%", height: "70%" }} strokeWidth={3.5} />
        </span>
      ) : null}
    </span>
  );
}

/** The trip agent's picture: navy with a mint sparkle, so it is never mistaken for a person. */
export function AgentAvatar({ size = 32, className }: Omit<AvatarProps, "name" | "dot">) {
  return (
    <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-primary text-action", className)} style={{ width: size, height: size }}>
      <Sparkles style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  );
}

export interface StackedPerson {
  readonly name: string;
  readonly dot?: boolean;
  readonly commitment?: Commitment | null;
}

interface AvatarStackProps {
  readonly people: readonly StackedPerson[];
  /** How many avatars to draw before folding the rest into "+N". */
  readonly max?: number;
  readonly size?: number;
  readonly className?: string;
}

/** Overlapping avatars for a group, with a "+N" for the ones that do not fit. Reads aloud as the list of names. */
export function AvatarStack({ people, max = 4, size = 26, className }: AvatarStackProps) {
  const { shown, hiddenCount } = splitForStack(people, max);
  return (
    <span className={cn("inline-flex items-center", className)}>
      <span className="sr-only">{people.map((person) => (person.commitment ? `${person.name} (${commitmentLabel(person.commitment).toLowerCase()})` : person.name)).join(", ")}</span>
      {shown.map((person, index) => (
        <Avatar key={`${person.name}-${index}`} name={person.name} size={size} dot={person.dot} commitment={person.commitment} className={cn("rounded-full ring-2 ring-card", index > 0 && "-ml-2")} />
      ))}
      {hiddenCount > 0 ? (
        <span aria-hidden="true" className="ml-1.5 text-xs font-medium text-muted-foreground">
          +{hiddenCount}
        </span>
      ) : null}
    </span>
  );
}
