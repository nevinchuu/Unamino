import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/infrastructure/db/schema/index.ts",
  out: "./drizzle",
  // Only needed to apply a migration. Generating one reads the schema and never connects.
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
