require('dotenv').config();
const { loadEvents, disconnect } = require('../indexer/src/store');

async function checkEvents() {
  const wallet = process.env.TARGET_WALLET || process.argv[2];

  console.log(`Checking events for wallet: ${wallet}\n`);

  const allEvents = await loadEvents();

  if (wallet) {
    const events = allEvents.filter(e => e.wallet.toLowerCase() === wallet.toLowerCase());

    if (events.length === 0) {
      console.log('No events found for this wallet in the database.');
    } else {
      console.log(`Found ${events.length} event(s):\n`);
      events.forEach((event, i) => {
        console.log(`${i + 1}. ${event.eventName} (${event.protocol} on ${event.chain})`);
        console.log(`   Block: ${event.blockNumber}, Tx: ${event.txHash}`);
        console.log(`   Asset: ${event.asset || 'N/A'}, Amount: ${event.amount}`);
        console.log(`   Proven: ${event.proven ? '✓' : '✗'}`);
        console.log();
      });
    }
  } else {
    console.log(`Total events in database: ${allEvents.length}\n`);
    allEvents.forEach((event, i) => {
      console.log(`${i + 1}. ${event.eventName} (${event.protocol} on ${event.chain})`);
      console.log(`   Wallet: ${event.wallet}`);
      console.log(`   Block: ${event.blockNumber}, Tx: ${event.txHash}`);
      console.log(`   Asset: ${event.asset || 'N/A'}, Amount: ${event.amount}`);
      console.log(`   Proven: ${event.proven ? '✓' : '✗'}`);
      console.log();
    });
  }

  await disconnect();
}

checkEvents().catch(console.error);