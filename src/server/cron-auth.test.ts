import { describe, expect, it } from "vitest";
import { isCronAuthorized, MIN_CRON_SECRET_LENGTH } from "./cron-auth";

const SECRET = "a".repeat(MIN_CRON_SECRET_LENGTH);

describe("isCronAuthorized", () => {
  it("accepts the right bearer token", () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it.each([null, "", SECRET, `bearer ${SECRET}`, `Bearer ${SECRET} `, `Bearer ${SECRET}x`, "Bearer wrong", `Basic ${SECRET}`])("refuses %j", (header) => {
    expect(isCronAuthorized(header, SECRET)).toBe(false);
  });

  it("fails closed when no secret is set", () => {
    expect(isCronAuthorized("Bearer undefined", null)).toBe(false);
    expect(isCronAuthorized("Bearer ", "")).toBe(false);
    expect(isCronAuthorized("Bearer null", null)).toBe(false);
  });

  it("refuses a secret that is too short, even when the caller sends exactly it", () => {
    const short = "a".repeat(MIN_CRON_SECRET_LENGTH - 1);
    expect(isCronAuthorized(`Bearer ${short}`, short)).toBe(false);
  });
});
