import { z } from "zod";
import { err, ok, type Result } from "@/lib/result";
import { constraintSetSchema } from "@/domain/constraints/schema";
import type { PlanValidationError } from "./errors";

const MAX_PICKS = 20;
const MAX_MEMBERS = 12;
const MAX_REPORTED_ISSUES = 3;
const CODE_FENCE_START = /^```(?:json)?\s*/i;
const CODE_FENCE_END = /\s*```$/;

/**
 * What the planner returns when it reads the group chat: each member's constraints.
 * Unknown fields are rejected, so the model cannot smuggle in anything else.
 */
export const extractionOutputSchema = z.strictObject({ constraints: constraintSetSchema });
export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;

/**
 * What the planner returns when it picks a plan. Offers are referenced by id only and there is no price
 * field, so the planner cannot invent or alter a price. Each pick names who the offer is for and why it fits.
 */
export const plannerOutputSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(500).optional(),
  picks: z
    .array(
      z.strictObject({
        offerId: z.string().min(1),
        reason: z.string().trim().min(1).max(300),
        members: z
          .array(z.strictObject({ memberId: z.string().min(1), note: z.string().trim().min(1).max(160) }))
          .min(1)
          .max(MAX_MEMBERS),
      }),
    )
    .min(1)
    .max(MAX_PICKS),
  /** Where the plan does not fully suit someone, in the planner's own words. Code checks the facts separately. */
  compromises: z
    .array(z.strictObject({ memberId: z.string().min(1), note: z.string().trim().min(1).max(300) }))
    .max(MAX_MEMBERS)
    .optional(),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

const stripCodeFences = (text: string): string => text.trim().replace(CODE_FENCE_START, "").replace(CODE_FENCE_END, "");

export function parseWith<T>(schema: z.ZodType<T>, value: unknown, what: string): Result<T, PlanValidationError> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return ok(parsed.data);
  const summary = parsed.error.issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return err({ code: "invalid_shape", message: `${what} does not match the schema: ${summary}` });
}

export function parseJson(text: string, what: string): Result<unknown, PlanValidationError> {
  try {
    return ok(JSON.parse(stripCodeFences(text)));
  } catch {
    return err({ code: "invalid_json", message: `${what} is not valid JSON` });
  }
}

export const parsePlannerOutput = (value: unknown): Result<PlannerOutput, PlanValidationError> =>
  parseWith(plannerOutputSchema, value, "Planner output");

export const parseExtractionOutput = (value: unknown): Result<ExtractionOutput, PlanValidationError> =>
  parseWith(extractionOutputSchema, value, "Constraint output");

/** Parses the model's raw text, tolerating the code fences models often add around JSON. */
export function parsePlannerText(text: string): Result<PlannerOutput, PlanValidationError> {
  const json = parseJson(text, "Planner output");
  return json.ok ? parsePlannerOutput(json.value) : json;
}

export function parseExtractionText(text: string): Result<ExtractionOutput, PlanValidationError> {
  const json = parseJson(text, "Constraint output");
  return json.ok ? parseExtractionOutput(json.value) : json;
}
