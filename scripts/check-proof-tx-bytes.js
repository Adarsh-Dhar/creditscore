require("dotenv").config();
const { ethers } = require("ethers");
const { chainInfo, proofProvider } = require("@gluwa/usc-sdk");

const SEPOLIA_RPC = process.env.SEPOLIA_RPC;
const CC3_TESTNET_RPC = process.env.CC3_TESTNET_RPC;
const PROVER_API_URL = process.env.PROVER_API_URL;

// Test transactions
const COMPOUND_TX = "0x68c7996b55842d8195c3d41f8d0d0b7c771a77ae7e18c180f4a5effe53dbc607";
const AAVE_TX = "0x2315156698212c4cfec1c2dc85e047ed816748d660483bc3a1ec371a9661647c";

async function checkProofTxBytes(txHash, protocolName) {
  console.log(`\n=== Checking ${protocolName} transaction: ${txHash} ===`);
  
  const sourceProvider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const tx = await sourceProvider.getTransaction(txHash);
  
  console.log(`Original tx.to: ${tx.to}`);
  console.log(`Original tx.data: ${tx.data}`);
  
  // Get chain key
  const creditcoinProvider = new ethers.JsonRpcProvider(CC3_TESTNET_RPC);
  const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(creditcoinProvider);
  const supportedChains = await chainInfoProvider.getSupportedChains();
  const chainEntry = supportedChains.find((c) => c.chainId === 11155111);
  const chainKey = chainEntry.chainKey;
  
  console.log(`Chain key: ${chainKey}`);
  
  // Generate proof
  const proofBuilder = new proofProvider.service.ProofBuilder(chainKey, PROVER_API_URL);
  await proofBuilder.waitUntilHeightAttested(chainKey, tx.blockNumber);
  
  const result = await proofBuilder.getProof(txHash);
  if (!result.success || !result.data) {
    console.log(`Proof generation failed: ${result.error}`);
    return;
  }
  
  const { txBytes } = result.data;
  console.log(`Proof txBytes length: ${txBytes.length}`);
  console.log(`Proof txBytes (hex): ${txBytes}`);
  
  // Decode the txBytes to check the to field
  try {
    const decodedTx = ethers.Transaction.from(txBytes);
    console.log(`Decoded tx.to from proof: ${decodedTx.to}`);
    console.log(`Match: ${decodedTx.to.toLowerCase() === tx.to.toLowerCase()}`);
  } catch (error) {
    console.log(`Failed to decode txBytes: ${error.message}`);
  }
}

async function main() {
  await checkProofTxBytes(AAVE_TX, "Aave");
  await checkProofTxBytes(COMPOUND_TX, "Compound");
}

main().catch(console.error);
