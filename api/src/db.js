require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

// Validate DATABASE_URL is configured
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not configured in .env file');
}

// Check if using placeholder credentials
if (process.env.DATABASE_URL.includes('user:password') || process.env.DATABASE_URL.includes('user:password@localhost')) {
  console.error('⚠️  WARNING: Using placeholder database credentials');
  console.error('Please configure your actual PostgreSQL credentials in api/.env');
  console.error('Format: postgresql://username:password@localhost:5432/database_name');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

module.exports = prisma;
