import { describe, expect, it } from "vitest";
import { validateTravellerInput } from "./details";
import { SAMPLE_DETAILS } from "./test-support";

const NOW = new Date("2026-10-27T12:00:00.000Z");
const rules = { now: NOW, passportRequired: true };
const without = { now: NOW, passportRequired: false };

const errorsOf = (input: unknown, r = rules) => {
  const result = validateTravellerInput(input, r);
  return result.ok ? null : result.error;
};

describe("validateTravellerInput", () => {
  it("accepts complete details", () => {
    expect(validateTravellerInput(SAMPLE_DETAILS, rules)).toEqual({ ok: true, value: SAMPLE_DETAILS });
  });

  it("tidies what people type: spaces trimmed, codes and passport numbers upper-cased", () => {
    const result = validateTravellerInput({ ...SAMPLE_DETAILS, firstName: "  Daniel ", nationality: "sg", passport: { number: "k1234567a", issueCountry: "sg", expiry: "2031-06-01" } }, rules);
    expect(result).toMatchObject({ ok: true, value: { firstName: "Daniel", nationality: "SG", passport: { number: "K1234567A", issueCountry: "SG" } } });
  });

  it("accepts names with accents, hyphens and apostrophes", () => {
    expect(validateTravellerInput({ ...SAMPLE_DETAILS, firstName: "Anne-Marie", lastName: "O'Brien-Núñez" }, rules).ok).toBe(true);
  });

  it("says which field is wrong, in words for a person", () => {
    const errors = errorsOf({ ...SAMPLE_DETAILS, firstName: "", email: "nope", gender: "Q", phoneNumber: "12 34", nationality: "Singapore" });
    expect(errors).toMatchObject({
      firstName: "Enter your first name.",
      email: "Enter a valid email address.",
      gender: "Choose M, F or X, as it is on your passport.",
      phoneNumber: "Enter your phone number as digits only, with no spaces.",
      nationality: "Choose your nationality.",
    });
  });

  it("refuses names with digits or symbols", () => {
    expect(errorsOf({ ...SAMPLE_DETAILS, lastName: "Tan2" })).toHaveProperty("lastName");
    expect(errorsOf({ ...SAMPLE_DETAILS, lastName: "<script>" })).toHaveProperty("lastName");
  });

  it("refuses impossible or unwritten dates", () => {
    for (const birthday of ["1990-02-30", "17/05/1990", "1990-5-17", "", "tomorrow"]) {
      expect(errorsOf({ ...SAMPLE_DETAILS, birthday }), birthday).toHaveProperty("birthday");
    }
  });

  it("refuses a birthday that is today, in the future or more than 120 years ago", () => {
    expect(errorsOf({ ...SAMPLE_DETAILS, birthday: "2026-10-27" })).toHaveProperty("birthday");
    expect(errorsOf({ ...SAMPLE_DETAILS, birthday: "2027-01-01" })).toHaveProperty("birthday");
    expect(errorsOf({ ...SAMPLE_DETAILS, birthday: "1900-01-01" })).toHaveProperty("birthday");
    expect(errorsOf({ ...SAMPLE_DETAILS, birthday: "2026-10-26" })).toBeNull();
  });

  it("refuses a passport that has expired or expires today", () => {
    expect(errorsOf({ ...SAMPLE_DETAILS, passport: { ...SAMPLE_DETAILS.passport, expiry: "2026-10-27" } })).toEqual({ "passport.expiry": "That passport has expired." });
    expect(errorsOf({ ...SAMPLE_DETAILS, passport: { ...SAMPLE_DETAILS.passport, expiry: "2020-01-01" } })).toHaveProperty("passport.expiry");
  });

  it("refuses a passport number with spaces or symbols", () => {
    for (const number of ["K 123 456", "K-1234567", "AB1"]) {
      expect(errorsOf({ ...SAMPLE_DETAILS, passport: { ...SAMPLE_DETAILS.passport, number } }), number).toHaveProperty("passport.number");
    }
  });

  it("asks for a passport only when the trip needs one", () => {
    const noPassport = { ...SAMPLE_DETAILS, passport: undefined };
    expect(errorsOf(noPassport, rules)).toEqual({ passport: "A passport is needed for this trip." });
    expect(validateTravellerInput(noPassport, without).ok).toBe(true);
  });

  it("does not keep a passport nobody needed", () => {
    const result = validateTravellerInput(SAMPLE_DETAILS, without);
    expect(result.ok && result.value.passport).toBeUndefined();
  });

  it.each([null, undefined, "text", 5, []])("refuses input that is not a form (%j)", (input) => {
    expect(errorsOf(input)).not.toBeNull();
  });
});
