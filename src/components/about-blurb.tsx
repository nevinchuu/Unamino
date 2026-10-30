/** What the app is, in one line, in a box above the form, for someone who has only been sent a link. */
export function AboutBlurb({ className }: { readonly className?: string }) {
  return (
    <section aria-label="About Unamino" className={className ?? "rounded-2xl bg-card px-4 py-3 text-left text-sm leading-5 shadow-soft"}>
      <p>Plan trips with AI Helper. Nobody pays until everyone&apos;s in.</p>
    </section>
  );
}
