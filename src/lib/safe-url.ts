/**
 * A link from outside is only used if it is a plain https address. Anything else (a script, a data URL, text that is
 * not an address at all) is dropped, so a bad value from a data source can never become something a person taps.
 */
export function httpsUrlOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
