/** What the admin's removal of a friend asks Trippy, posted in the admin's name so the group sees who asked for what. */
export const removedFriendRequest = (name: string): string => `@trippy ${name} is no longer coming. Please make a new plan for the rest of us, same trip.`;

/** The system line that follows a removal when Trippy has been asked to plan again. */
export const REPLANNING_NOTE = " The plan ended and every card hold was released. Trippy is making a new plan for the people left.";

/** What the chat says when Trippy could not be asked, so the group knows what to do. */
export const REPLAN_FAILED_LINE = "Mention @trippy to plan again.";
