import type { NextConfig } from "next";

/**
 * Headers every page gets. There is no script policy on purpose: Stripe's card form and Next's own scripts need
 * one written with care, and a wrong one would break the card step. These cover the rest: nobody can frame the
 * site, a join link never travels in a Referer header, and forms and base URLs stay on this site.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  // Browsers ignore this over plain http, so it only matters on the live site.
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  headers: async () => [{ source: "/:path*", headers: SECURITY_HEADERS }],
  // Opening the dev server as 127.0.0.1 gives a browser a separate cookie jar from localhost, which is how a second
  // person is tried out on one machine. Without this entry the page loads but never becomes interactive.
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
