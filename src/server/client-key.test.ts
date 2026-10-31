import { describe, expect, it } from "vitest";
import { clientAddressOf, creatorKeyFor } from "./client-key";

const headersOf = (entries: Record<string, string>): Pick<Headers, "get"> => ({ get: (name) => entries[name.toLowerCase()] ?? null });

describe("clientAddressOf", () => {
  it("takes the first address the platform forwarded, which is the client", () => {
    expect(clientAddressOf(headersOf({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, and is null when there is no address at all", () => {
    expect(clientAddressOf(headersOf({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientAddressOf(headersOf({}))).toBeNull();
    expect(clientAddressOf(headersOf({ "x-forwarded-for": " " }))).toBeNull();
  });
});

describe("creatorKeyFor", () => {
  it("gives the same key for the same address and secret, and a different one for another address or secret", () => {
    expect(creatorKeyFor("203.0.113.7", "s")).toBe(creatorKeyFor("203.0.113.7", "s"));
    expect(creatorKeyFor("203.0.113.7", "s")).not.toBe(creatorKeyFor("203.0.113.8", "s"));
    expect(creatorKeyFor("203.0.113.7", "s")).not.toBe(creatorKeyFor("203.0.113.7", "other"));
  });

  it("does not contain the address, and is a short hex string", () => {
    const key = creatorKeyFor("203.0.113.7", "s");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain("203");
  });

  it("is null when the address is not known", () => {
    expect(creatorKeyFor(null, "s")).toBeNull();
  });
});
