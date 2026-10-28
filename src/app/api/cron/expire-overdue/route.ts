import { getContainer } from "@/server/container";
import { handleExpireOverdue } from "@/server/cron-handler";

export async function GET(request: Request): Promise<Response> {
  const { plans, cronSecret, bookingSweeper, travellers } = getContainer();
  return handleExpireOverdue(request, { secret: cronSecret, service: plans, bookings: bookingSweeper, travellers, now: () => new Date() });
}
