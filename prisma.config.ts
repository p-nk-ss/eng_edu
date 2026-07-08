import path from "node:path";
import "dotenv/config"; // load .env for the Prisma CLI (it does not auto-load in Prisma 7)
import { defineConfig } from "prisma/config";

// Migrations/introspection connect directly (non-pooled Neon endpoint) via DIRECT_URL.
// Runtime connects via the pg adapter with the pooled DATABASE_URL (see src/lib/db.ts).
// `datasource` is only attached when DIRECT_URL is present so `prisma generate` works
// without a database configured (e.g. before Neon is set up).
const directUrl = process.env.DIRECT_URL;

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  ...(directUrl ? { datasource: { url: directUrl } } : {}),
});
