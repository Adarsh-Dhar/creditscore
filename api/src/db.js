const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not configured in .env file');
}

if (process.env.DATABASE_URL.includes('user:password') || process.env.DATABASE_URL.includes('user:password@localhost')) {
  console.error('⚠️  WARNING: Using placeholder database credentials');
  console.error('Please configure your actual PostgreSQL credentials in .env');
  console.error('Format: postgresql://username:password@localhost:5433/database_name');
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

module.exports = prisma;
