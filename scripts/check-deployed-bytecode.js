require('dotenv').config();
const { ethers } = require('ethers');

async function checkDeployedBytecode() {
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  const CC3_TESTNET_RPC = process.env.CC3_TESTNET_RPC;

  if (!CONTRACT_ADDRESS || !CC3_TESTNET_RPC) {
    console.error('Missing required environment variables');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(CC3_TESTNET_RPC);

  const bytecode = await provider.getCode(CONTRACT_ADDRESS);
  console.log(`Contract bytecode length: ${bytecode.length} characters`);

  // Check for the selector in the bytecode
  const oldSelector = '49f5c3f8';
  const newSelector = 'f26493a3';

  if (bytecode.includes(oldSelector)) {
    console.log(`✗ Found OLD selector in bytecode: 0x${oldSelector}`);
  }
  if (bytecode.includes(newSelector)) {
    console.log(`✓ Found NEW selector in bytecode: 0x${newSelector}`);
  }

  // Extract a portion of the bytecode around where selectors might be
  const selectorIndex = bytecode.indexOf(newSelector);
  if (selectorIndex !== -1) {
    console.log(`New selector found at index ${selectorIndex}`);
    console.log(`Context: ${bytecode.substring(selectorIndex - 20, selectorIndex + 40)}`);
  }
}

checkDeployedBytecode().catch(console.error);