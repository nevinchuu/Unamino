"use client";

import { Loader2, Lock } from "lucide-react";
import { useId, useMemo, useState, type FormEvent } from "react";
import { TextField } from "@/components/text-field";
import { Button } from "@/components/ui/button";
import { countryOptions } from "@/lib/countries";
import { saveTravellerDetails } from "./actions";

interface TravellerFormProps {
  readonly groupId: string;
  readonly planId: string;
  /** True when the person is on a flight, which needs a passport. */
  readonly passportRequired: boolean;
  /** Called once the details are saved. */
  readonly onSaved: () => void;
}

type Errors = Readonly<Record<string, string>>;

const digits = (value: FormDataEntryValue | null): string => String(value ?? "").replace(/\D/g, "");
const text = (value: FormDataEntryValue | null): string => String(value ?? "").trim();

/** A drop-down styled like the text fields, with the same quiet label and red line for a problem. */
function SelectField({ label, name, error, children, autoComplete }: { readonly label: string; readonly name: string; readonly error?: string; readonly children: React.ReactNode; readonly autoComplete?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue=""
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        className="w-full border-0 border-b-2 border-input bg-transparent px-0 py-2 text-base text-foreground outline-none transition-colors focus:border-primary aria-invalid:border-destructive"
      >
        {children}
      </select>
      <p aria-live="polite" className="min-h-4 text-xs text-destructive">
        {error}
      </p>
    </div>
  );
}

/** What the airline and the hotel need to know about one traveller. It is locked before it is saved, and only the booking reads it. */
export function TravellerForm({ groupId, planId, passportRequired, onSaved }: TravellerFormProps) {
  const countries = useMemo(() => countryOptions(), []);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage(null);
    setErrors({});
    try {
      const result = await saveTravellerDetails(groupId, planId, {
        firstName: text(form.get("firstName")),
        lastName: text(form.get("lastName")),
        birthday: text(form.get("birthday")),
        gender: text(form.get("gender")),
        nationality: text(form.get("nationality")),
        email: text(form.get("email")),
        // People type "+65" or "9123 4567"; only the digits are kept.
        phoneCountryCode: digits(form.get("phoneCountryCode")),
        phoneNumber: digits(form.get("phoneNumber")),
        passport: passportRequired ? { number: text(form.get("passportNumber")).replace(/\s+/g, ""), issueCountry: text(form.get("passportCountry")), expiry: text(form.get("passportExpiry")) } : undefined,
      });
      if (result.ok) return onSaved();
      setMessage(result.error);
      setErrors(result.fields ?? {});
    } catch {
      setMessage("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const options = countries.map((country) => (
    <option key={country.code} value={country.code}>
      {country.name}
    </option>
  ));

  return (
    <form onSubmit={submit} className="mt-4 space-y-1" noValidate>
      <p className="mb-2 text-sm text-muted-foreground">Use your name exactly as it appears on your passport.</p>
      <div className="grid grid-cols-2 gap-x-4">
        <TextField label="First name" name="firstName" autoComplete="given-name" error={errors.firstName} />
        <TextField label="Last name" name="lastName" autoComplete="family-name" error={errors.lastName} />
      </div>
      <div className="grid grid-cols-2 gap-x-4">
        <TextField label="Date of birth" name="birthday" type="date" autoComplete="bday" error={errors.birthday} />
        <SelectField label="Gender on passport" name="gender" error={errors.gender}>
          <option value="" disabled>
            Choose
          </option>
          <option value="F">Female (F)</option>
          <option value="M">Male (M)</option>
          <option value="X">Unspecified (X)</option>
        </SelectField>
      </div>
      <SelectField label="Nationality" name="nationality" error={errors.nationality}>
        <option value="" disabled>
          Choose
        </option>
        {options}
      </SelectField>
      <TextField label="Email" name="email" type="email" inputMode="email" autoComplete="email" error={errors.email} />
      <div className="grid grid-cols-[6rem_1fr] gap-x-4">
        <TextField label="Country code" name="phoneCountryCode" inputMode="tel" placeholder="65" autoComplete="tel-country-code" error={errors.phoneCountryCode} />
        <TextField label="Phone number" name="phoneNumber" inputMode="tel" autoComplete="tel-national" error={errors.phoneNumber} />
      </div>

      {passportRequired ? (
        <>
          <p className="pt-2 text-sm font-medium">Passport</p>
          <TextField label="Passport number" name="passportNumber" autoComplete="off" autoCapitalize="characters" error={errors["passport.number"] ?? errors.passport} />
          <div className="grid grid-cols-2 gap-x-4">
            <SelectField label="Issued by" name="passportCountry" error={errors["passport.issueCountry"]}>
              <option value="" disabled>
                Choose
              </option>
              {options}
            </SelectField>
            <TextField label="Expires" name="passportExpiry" type="date" error={errors["passport.expiry"]} />
          </div>
        </>
      ) : null}

      {message ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {message}
        </p>
      ) : null}
      <Button type="submit" disabled={busy} className="mt-2 h-12 w-full rounded-full text-base font-semibold">
        {busy ? <Loader2 className="size-5 animate-spin" /> : "Save and continue"}
      </Button>
      <p className="flex items-start justify-center gap-1 pt-1 text-center text-xs text-muted-foreground">
        <Lock className="mt-0.5 size-3 shrink-0" />
        Locked before it is saved. Never shown to the group or the AI. Deleted as soon as the trip is booked, or the plan ends.
      </p>
    </form>
  );
}
