require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const txHash = '0xeeacbc589ea48fa3c96309eaed976be51ea1b8be030b8ddca4bacc58c25a1c07';
  
  console.log('Marking transaction as proven:', txHash);
  
  const result = await prisma.indexedEvent.updateMany({
    where: { txHash },
    data: { proven: true }
  });
  
  console.log(`Updated ${result.count} event(s)`);
  
  // Verify the update
  const event = await prisma.indexedEvent.findFirst({
    where: { txHash }
  });
  
  console.log('Event status:', event);
  
  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);