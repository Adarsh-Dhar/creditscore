require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const myWallet = '0xb8552ec41cd7b5697464602d24d9c174F6FB863C';
  
  console.log('Checking for events from wallet:', myWallet);
  
  const events = await prisma.indexedEvent.findMany({
    where: { wallet: myWallet },
    orderBy: { blockNumber: 'desc' }
  });
  
  console.log(`Found ${events.length} events for your wallet:`);
  events.forEach(e => {
    console.log(`  ${(e.eventName || 'UNKNOWN').padEnd(15)} block=${e.blockNumber} tx=${e.txHash} proven=${e.proven}`);
  });
  
  // Also check the recent successful transaction
  const specificTx = await prisma.indexedEvent.findFirst({
    where: { txHash: '0xeeacbc589ea48fa3c96309eaed976be51ea1b8be030b8ddca4bacc58c25a1c07' }
  });
  
  console.log('\nChecking for the successful LINK tx:');
  if (specificTx) {
    console.log('Found in database:', specificTx);
  } else {
    console.log('NOT found in database');
  }

  // Check for unproven events
  console.log('\nChecking for unproven events in database...');
  const unprovenEvents = await prisma.indexedEvent.findMany({
    where: { proven: false },
    orderBy: { blockNumber: 'asc' }
  });
  
  console.log(`Found ${unprovenEvents.length} unproven events:`);
  unprovenEvents.forEach(e => {
    console.log(`  ${e.eventName.padEnd(15)} wallet=${e.wallet.substring(0,10)}... block=${e.blockNumber} tx=${e.txHash.substring(0,10)}...`);
  });
  
  // Also check total events
  const totalEvents = await prisma.indexedEvent.count();
  const provenEvents = await prisma.indexedEvent.count({ where: { proven: true } });
  
  console.log(`\nDatabase stats:`);
  console.log(`  Total events: ${totalEvents}`);
  console.log(`  Proven events: ${provenEvents}`);
  console.log(`  Unproven events: ${unprovenEvents.length}`);
  
  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);