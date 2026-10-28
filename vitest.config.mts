import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The real package throws when a client bundle imports it. Tests run in Node, where that is not a question.
      "server-only": fileURLToPath(new URL("./src/test-support/empty.ts", import.meta.url)),
    },
  },
});
