import { describe, expect, it } from "vitest";
import { findClash } from "./clash";

const december = { departDate: "2026-12-07", returnDate: "2026-12-13" };

describe("findClash", () => {
  it("allows a trip that starts after the booked one ends", () => {
    expect(findClash({ departDate: "2026-12-16", returnDate: "2026-12-24" }, [december])).toBeNull();
  });

  it("allows a trip that ends before the booked one starts", () => {
    expect(findClash({ departDate: "2026-11-20", returnDate: "2026-12-06" }, [december])).toBeNull();
  });

  it("refuses a trip inside, around or across the booked one", () => {
    expect(findClash({ departDate: "2026-12-09", returnDate: "2026-12-12" }, [december])).toBe(december);
    expect(findClash({ departDate: "2026-12-01", returnDate: "2026-12-31" }, [december])).toBe(december);
    expect(findClash({ departDate: "2026-12-12", returnDate: "2026-12-20" }, [december])).toBe(december);
    expect(findClash({ departDate: "2026-12-01", returnDate: "2026-12-08" }, [december])).toBe(december);
  });

  it("counts the first and last day as taken", () => {
    expect(findClash({ departDate: "2026-12-13", returnDate: "2026-12-15" }, [december])).toBe(december);
    expect(findClash({ departDate: "2026-12-04", returnDate: "2026-12-07" }, [december])).toBe(december);
  });

  it("finds the clashing trip among several, and nothing among none", () => {
    const january = { departDate: "2027-01-08", returnDate: "2027-01-10" };
    expect(findClash({ departDate: "2027-01-09", returnDate: "2027-01-12" }, [december, january])).toBe(january);
    expect(findClash({ departDate: "2027-01-09", returnDate: "2027-01-12" }, [])).toBeNull();
  });
});
