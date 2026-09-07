import 'dotenv/config';
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.js';
import contractJson from './contract.json' with { type: 'json' };

const client = postgres<Contract>({
  contractJson,
  url: process.env.DATABASE_URL!,
});

export const db = await client.connect();