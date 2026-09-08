#!/usr/bin/env node
/**
 * Runs `prisma db migrate` and exits non-zero if the migration fails.
 *
 * Why this wrapper exists:
 *   prisma db migrate (v8 RC) exits with code 0 even when the migration
 *   fails (e.g. connection error, constraint violation). GitHub Actions
 *   sees "success" and moves on, leaving the DB untouched. This script
 *   parses the JSON output and converts a failed result into exit code 1.
 *
 * Usage:
 *   node scripts/migrate.mjs
 *   DATABASE_URL=postgresql://... node scripts/migrate.mjs
 */

import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('ERROR: DATABASE_URL is not set');
  process.exit(1);
}

const prismaArgs = [
  'db', 'migrate',
  '--db', dbUrl,
  '--json',
];

console.log('Running: prisma db migrate --db <DATABASE_URL> --json');

const result = spawnSync(
  resolve(root, 'node_modules/.bin/prisma'),
  prismaArgs,
  { cwd: root, stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf8' }
);

const combined = (result.stdout || '') + (result.stderr || '');
console.log(combined);

// prisma db migrate outputs one JSON object per line; parse each
let failed = false;
for (const line of combined.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) continue;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed?.kind === 'result' && parsed?.envelope?.ok === false) {
      console.error('\nMigration FAILED:');
      console.error(JSON.stringify(parsed.envelope.error, null, 2));
      failed = true;
    }
  } catch {
    // not JSON — skip
  }
}

if (result.status !== 0 || failed) {
  console.error('\nMigration did not complete successfully.');
  process.exit(1);
}

console.log('\nMigration completed successfully.');
