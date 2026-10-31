import { createHmac } from "node:crypto";

/**
 * The address the request came from, as the platform reports it. On Vercel the first entry of `x-forwarded-for` is the
 * client, written by the platform and not by the caller. Null when there is none, such as on a laptop in development.
 */
export function clientAddressOf(headers: Pick<Headers, "get">): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || headers.get("x-real-ip")?.trim();
  return address ? address : null;
}

/**
 * A keyed hash of the address, so groups can be counted per person without keeping anyone's address: the key stays on
 * the server, so a stored value cannot be turned back into an address by trying every address. Null for no address.
 */
export function creatorKeyFor(address: string | null, secret: string | null): string | null {
  if (address === null) return null;
  return createHmac("sha256", secret ?? "development").update(`group-creator:${address}`).digest("hex").slice(0, 32);
}
