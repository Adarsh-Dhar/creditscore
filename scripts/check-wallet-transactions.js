require('dotenv').config();
const { ethers } = require('ethers');

async function checkWalletTransactions() {
  const wallet = process.env.TARGET_WALLET || process.argv[2];
  const SEPOLIA_RPC = process.env.SEPOLIA_RPC;
  const AAVE_POOL = '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951';

  if (!wallet) {
    console.error('Please provide a wallet address');
    process.exit(1);
  }

  if (!SEPOLIA_RPC) {
    console.error('SEPOLIA_RPC not configured');
    process.exit(1);
  }

  console.log(`Checking transactions for wallet: ${wallet}`);
  console.log(`Aave Pool: ${AAVE_POOL}\n`);

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);

  // Get recent blocks
  const latestBlock = await provider.getBlockNumber();
  console.log(`Latest block: ${latestBlock}`);
  console.log(`Checking last 1000 blocks...\n`);

  const AAVE_POOL_ABI = [
    "event Supply(address indexed caller, address indexed onBehalfOf, address asset, uint256 amount, uint256 indexed referralCode)",
    "event Borrow(address indexed caller, address indexed onBehalfOf, address asset, uint256 amount, uint256 interestRateMode, uint256 indexed referralCode)",
    "event Repay(address indexed caller, address indexed onBehalfOf, address asset, uint256 amount, uint256 indexed referralCode)",
    "event Withdraw(address indexed caller, address indexed to, address asset, uint256 amount, uint256 indexed referralCode)",
    "event LiquidationCall(address indexed initiator, address indexed asset, address indexed collateralAsset, address user, uint256 debtToCover, uint256 liquidatedCollateralAmount, bool receiveAToken)",
  ];

  const pool = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, provider);

  let foundEvents = 0;
  const startBlock = Math.max(0, latestBlock - 1000);

  try {
    const supplyFilter = pool.filters.Supply(wallet);
    const supplyEvents = await pool.queryFilter(supplyFilter, startBlock, latestBlock);
    foundEvents += supplyEvents.length;
    console.log(`Supply events: ${supplyEvents.length}`);
    supplyEvents.forEach(e => console.log(`  Block ${e.blockNumber}: ${e.transactionHash}`));

    const borrowFilter = pool.filters.Borrow(wallet);
    const borrowEvents = await pool.queryFilter(borrowFilter, startBlock, latestBlock);
    foundEvents += borrowEvents.length;
    console.log(`Borrow events: ${borrowEvents.length}`);
    borrowEvents.forEach(e => console.log(`  Block ${e.blockNumber}: ${e.transactionHash}`));

    const repayFilter = pool.filters.Repay(wallet);
    const repayEvents = await pool.queryFilter(repayFilter, startBlock, latestBlock);
    foundEvents += repayEvents.length;
    console.log(`Repay events: ${repayEvents.length}`);
    repayEvents.forEach(e => console.log(`  Block ${e.blockNumber}: ${e.transactionHash}`));

    const withdrawFilter = pool.filters.Withdraw(wallet);
    const withdrawEvents = await pool.queryFilter(withdrawFilter, startBlock, latestBlock);
    foundEvents += withdrawEvents.length;
    console.log(`Withdraw events: ${withdrawEvents.length}`);
    withdrawEvents.forEach(e => console.log(`  Block ${e.blockNumber}: ${e.transactionHash}`));

    console.log(`\nTotal events found: ${foundEvents}`);

    if (foundEvents === 0) {
      console.log(`\nNo Aave events found for ${wallet} in the last 1000 blocks.`);
      console.log('This wallet may not have interacted with Aave on Sepolia yet.');
    }
  } catch (error) {
    console.error('Error checking events:', error.message);
  }
}

checkWalletTransactions().catch(console.error);