require('dotenv').config();
const { ethers } = require('ethers');

async function setWETHGatewayAddress() {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  const CC3_TESTNET_RPC = process.env.CC3_TESTNET_RPC;

  if (!PRIVATE_KEY || !CONTRACT_ADDRESS || !CC3_TESTNET_RPC) {
    console.error('Missing required environment variables');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(CC3_TESTNET_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log('Setting WETHGateway address on CreditScoreMVP contract...');
  console.log(`Contract: ${CONTRACT_ADDRESS}`);
  console.log(`From wallet: ${wallet.address}`);

  const contract = new ethers.Contract(
    CONTRACT_ADDRESS,
    ['function setWETHGatewayAddress(uint64 chainKey, uint8 protocolId, address gateway) external'],
    wallet
  );

  // Sepolia chainKey is 1, Aave protocolId is 0
  const chainKey = 1; // Sepolia
  const protocolId = 0; // Aave
  const gatewayAddress = '0x387d311e47e80b498169e6fb51d3193167d89F7D';

  console.log(`Setting WETHGateway for chainKey=${chainKey}, protocolId=${protocolId}`);
  console.log(`Gateway address: ${gatewayAddress}`);

  const tx = await contract.setWETHGatewayAddress(chainKey, protocolId, gatewayAddress);
  console.log(`Transaction hash: ${tx.hash}`);
  console.log('Waiting for confirmation...');

  const receipt = await tx.wait();
  console.log(`✅ WETHGateway address set successfully in block ${receipt.blockNumber}`);
  console.log(`Gas used: ${receipt.gasUsed.toString()}`);
}

setWETHGatewayAddress().catch(console.error);