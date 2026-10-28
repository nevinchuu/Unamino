import { describe, expect, it } from "vitest";
import { httpsUrlOrNull } from "./safe-url";

describe("httpsUrlOrNull", () => {
  it("keeps an https address", () => {
    expect(httpsUrlOrNull("https://maps.google.com/?cid=123")).toBe("https://maps.google.com/?cid=123");
  });

  it("drops scripts, data URLs, plain http, files and text that is not an address", () => {
    for (const value of ["javascript:alert(1)", "data:text/html,<b>x</b>", "http://maps.google.com", "file:///etc/passwd", "not a url", "//evil.example", ""]) {
      expect(httpsUrlOrNull(value), value).toBeNull();
    }
  });

  it("treats a missing value as no link", () => {
    expect(httpsUrlOrNull(null)).toBeNull();
    expect(httpsUrlOrNull(undefined)).toBeNull();
  });
});
