/** Remembers, for each person, how far through a group's chat they have read, so a chat with newer messages can show as unread. */
export interface ReadMarkers {
  /** The `seq` of the newest message each person has had on screen. A person who has read nothing, or is not found, is 0. */
  lastRead(memberIds: readonly string[]): Promise<ReadonlyMap<string, number>>;
  /** Moves the marker forward to `seq`. It never moves back, so a slow old poll arriving late cannot make read messages unread again. */
  markRead(memberId: string, seq: number): Promise<void>;
}
