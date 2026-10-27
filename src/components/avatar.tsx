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
