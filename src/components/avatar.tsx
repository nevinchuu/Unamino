import { Sparkles } from "lucide-react";
import { avatarColour, initialsOf } from "@/lib/avatar";
import { cn } from "@/lib/utils";

interface AvatarProps {
  /** The person or group the avatar stands for. Its first letters and its colour come from this. */
  readonly name: string;
  /** Pixels. Letters scale with it. */
  readonly size?: number;
  readonly className?: string;
}

/** A round coloured circle with initials, the way a chat shows someone who has no photo. */
export function Avatar({ name, size = 40, className }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none", className)}
      style={{ width: size, height: size, backgroundColor: avatarColour(name), fontSize: Math.round(size * 0.4) }}
    >
      {initialsOf(name)}
    </span>
  );
}

/** The trip agent's picture: the brand blue with a sparkle, so it is never mistaken for a person. */
export function AgentAvatar({ size = 32, className }: Omit<AvatarProps, "name">) {
  return (
    <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground", className)} style={{ width: size, height: size }}>
      <Sparkles style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  );
}
