require('dotenv').config();
const { ethers } = require('ethers');

async function checkSelector() {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  const CC3_TESTNET_RPC = process.env.CC3_TESTNET_RPC;

  if (!CONTRACT_ADDRESS || !CC3_TESTNET_RPC) {
    console.error('Missing required environment variables');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(CC3_TESTNET_RPC);

  // Create a contract instance to call read-only functions
  const contract = new ethers.Contract(
    CONTRACT_ADDRESS,
    ['function SEL_AAVE_DEPOSIT_ETH() view returns (bytes4)'],
    provider
  );

  try {
    const selector = await contract.SEL_AAVE_DEPOSIT_ETH();
    console.log(`SEL_AAVE_DEPOSIT_ETH constant: 0x${selector.toString(16)}`);
    console.log(`Expected: 0xf26493a3`);
    console.log(`Match: ${selector.toString(16) === 'f26493a3' ? '✓' : '✗'}`);
  } catch (error) {
    console.error('Error reading selector:', error.message);
  }
}

checkSelector().catch(console.error);