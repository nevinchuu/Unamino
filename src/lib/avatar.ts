/** One or two capital letters for a name: "Nevin" is N, "Ana Lopez" is AL. Never empty, so an avatar always has something in it. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0])[0];
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : "";
  return (first + last).toUpperCase();
}

/** A few calm colours, with enough contrast for white letters on top. */
const AVATAR_COLOURS = ["#1D5FA8", "#0B7A68", "#B4531A", "#7B3FB5", "#B0285D", "#0F7B8A", "#6B6F1A", "#3F51A3"] as const;

/** The same name always gets the same colour, so a person looks the same in every list and message. */
export function avatarColour(seed: string): string {
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length];
}
