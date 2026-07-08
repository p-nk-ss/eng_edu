import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma 7 CLI does not auto-load env. Load it the way Next.js does:
// .env first, then .env.local overrides (this is where DATABASE_URL lives).
loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

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

