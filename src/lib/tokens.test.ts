import { describe, expect, it } from "vitest";
import { generateToken, hashToken, isTokenShaped } from "./tokens";

describe("tokens", () => {
  it("makes long, different secrets that are shaped like tokens", () => {
    const first = generateToken();
    expect(first).toHaveLength(43);
    expect(isTokenShaped(first)).toBe(true);
    expect(generateToken()).not.toBe(first);
  });

  it("stores only a hash, which is not the secret", () => {
    const secret = generateToken();
    expect(hashToken(secret)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(secret)).not.toContain(secret);
    expect(hashToken(secret)).toBe(hashToken(secret));
  });

  it("turns away anything that is not shaped like a token", () => {
    for (const junk of ["", "abc", "x".repeat(42), "x".repeat(44), `${generateToken().slice(0, 42)}!`, "../etc/passwd", " ".repeat(43)]) expect(isTokenShaped(junk), junk).toBe(false);
  });
});
