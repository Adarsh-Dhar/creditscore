import 'dotenv/config';
import { Temporal } from '@js-temporal/polyfill';

if (!globalThis.Temporal) {
  globalThis.Temporal = Temporal;
}

import postgres from '@prisma/orm-postgres/runtime';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres({
    contractJson,
    url: process.env.DATABASE_URL,
});
