import path from "node:path";
import "dotenv/config"; // load .env for the Prisma CLI (it does not auto-load in Prisma 7)
import { defineConfig } from "prisma/config";

// Local PostgreSQL: one connection for both runtime and migrations (no pooler locally).
// Runtime connects via the pg adapter with DATABASE_URL (see src/lib/db.ts); the CLI
// (migrate/introspect) uses the same URL below. `datasource` is attached only when
// DATABASE_URL is present so `prisma generate` works before the DB exists.
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
  // `prisma db seed` runs the idempotent curriculum seed (see prisma/seed.ts).
  migrations: { seed: "tsx prisma/seed.ts" },
});

