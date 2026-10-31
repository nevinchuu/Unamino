/** What the app is, in one line, in a box above the form, for someone who has only been sent a link. */
export function AboutBlurb({ className }: { readonly className?: string }) {
  return (
    <section aria-label="About Unamino" className={className ?? "rounded-2xl bg-card px-4 py-3 text-left text-sm leading-5 shadow-soft"}>
      <p>Everyone approves their own amount. Nobody is charged unless everyone is in. Trippy, built on Meta&apos;s Muse Spark, gets the group to a plan everyone can say yes to.</p>
    </section>
  );
}
