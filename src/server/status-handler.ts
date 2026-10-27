import type { PlanStatusReader } from "@/domain/plan/status-reader";
import { isUuid } from "./ids";

const json = (body: unknown, status: number): Response => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * The public status of a plan, for anyone holding its id. An id that is malformed and one that does not exist
 * get the same answer, so the endpoint cannot be used to find out which ids are real.
 */
export async function handlePlanStatus(planId: string, reader: PlanStatusReader): Promise<Response> {
  if (!isUuid(planId)) return json({ error: "not_found" }, 404);

  const status = await reader.read(planId);
  if (!status.ok) {
    if (status.error.code === "not_found") return json({ error: "not_found" }, 404);
    console.error("plan status failed", status.error.code);
    return json({ error: "unavailable" }, 503);
  }
  const { status: state, memberCount, agreedCount, approvedCount, deadlineAt } = status.value;
  return json({ status: state, members: memberCount, agreed: agreedCount, approved: approvedCount, deadlineAt: deadlineAt.toISOString() }, 200);
}
