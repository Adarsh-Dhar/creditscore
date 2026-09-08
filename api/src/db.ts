// NOTE: In production (Render/Railway/etc.) DATABASE_URL is injected by the
// platform before Node starts — dotenv is only needed for local development.
// ESM static imports are hoisted and evaluated before any top-level code runs,
// so dotenv.config() calls here cannot fire before creditscore-db initialises.
// creditscore-db itself calls `import 'dotenv/config'` which reads .env from
// process.cwd() — that covers local dev. Production needs no .env file.

import { db } from "creditscore-db";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL environment variable is not set. " +
    "On Render/Railway: add it in the service's Environment tab. " +
    "Locally: add DATABASE_URL to api/.env or the repo root .env."
  );
}

if (
  process.env.DATABASE_URL.includes("user:password") ||
  process.env.DATABASE_URL.includes("user:password@localhost")
) {
  console.error("⚠️  WARNING: DATABASE_URL still contains placeholder credentials.");
  console.error("Replace it with your real connection string in .env");
  console.error("Format: postgresql://username:password@host:5432/database?sslmode=require");
}

export default db;
