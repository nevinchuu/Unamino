import { getContainer } from "@/server/container";
import { handleRetryEffects } from "@/server/retry-handler";

export async function GET(request: Request): Promise<Response> {
  const { payments, cronSecret } = getContainer();
  return handleRetryEffects(request, { secret: cronSecret, retrier: payments.retrier });
}
