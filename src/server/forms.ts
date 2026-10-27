import { z } from "zod";
import { err, ok, type Result } from "@/lib/result";
import { MAX_NAME_LENGTH, type GroupError } from "@/domain/group/types";

/** What a form sends back to the page when it did not go through: a message, and what the person had typed. */
export interface FormState {
  readonly message?: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
  readonly values?: Readonly<Record<string, string>>;
}

const nameField = (label: string) =>
  z.string().trim().min(1, `Enter ${label}`).max(MAX_NAME_LENGTH, `Use ${MAX_NAME_LENGTH} characters or fewer`);

const createGroupSchema = z.object({ groupName: nameField("a group name"), yourName: nameField("your name") });
const joinSchema = z.object({ yourName: nameField("your name") });

/** A text field's value, or empty. A file or a missing field counts as empty rather than breaking the form. */
const text = (data: FormData, name: string): string => {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
};

function parse<T>(schema: z.ZodType<T>, raw: Record<string, string>): Result<T, FormState> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return ok(parsed.data);
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0]);
    // The first problem with a field is the one worth showing.
    fieldErrors[field] ??= issue.message;
  }
  return err({ fieldErrors, values: raw });
}

export const parseCreateGroup = (data: FormData) => parse(createGroupSchema, { groupName: text(data, "groupName"), yourName: text(data, "yourName") });
export const parseJoin = (data: FormData) => parse(joinSchema, { yourName: text(data, "yourName") });

/** What to tell a person when group storage refused. Never the internal message. */
export function groupErrorMessage(error: GroupError): string {
  switch (error.code) {
    case "invalid_link":
      return "This invite link doesn't work any more. Ask for a new one.";
    case "group_full":
      return "This group is full.";
    case "invalid_input":
      return "Check the details and try again.";
    case "forbidden":
      return "Only the person who made the group can do that.";
    case "not_found":
      return "We couldn't find that group.";
    case "unavailable":
      return "Something went wrong on our side. Try again in a moment.";
  }
}
