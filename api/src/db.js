const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { PrismaClient } = require('@prisma/client');

// Validate DATABASE_URL is configured
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not configured in .env file');
}

// Check if using placeholder credentials
if (process.env.DATABASE_URL.includes('user:password') || process.env.DATABASE_URL.includes('user:password@localhost')) {
  console.error('⚠️  WARNING: Using placeholder database credentials');
  console.error('Please configure your actual PostgreSQL credentials in .env');
  console.error('Format: postgresql://username:password@localhost:5432/database_name');
}

const prisma = new PrismaClient();

module.exports = prisma;
