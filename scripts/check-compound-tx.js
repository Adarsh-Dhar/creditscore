require("dotenv").config();
const { ethers } = require("ethers");

const SEPOLIA_RPC = process.env.SEPOLIA_RPC;
const COMPOUND_TX = "0x68c7996b55842d8195c3d41f8d0d0b7c771a77ae7e18c180f4a5effe53dbc607";

async function main() {
  console.log("Checking Compound transaction details...");
  
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const tx = await provider.getTransaction(COMPOUND_TX);
  
  console.log("Transaction details:");
  console.log(`From: ${tx.from}`);
  console.log(`To: ${tx.to}`);
  console.log(`Value: ${tx.value}`);
  console.log(`Data: ${tx.data}`);
  console.log(`Block: ${tx.blockNumber}`);
  
  // Decode the function selector
  const selector = tx.data.substring(0, 10);
  console.log(`Function selector: ${selector}`);
  
  // Expected Compound supply selector
  const expectedSelector = "0xf2b9fdb8";
  console.log(`Expected supply selector: ${expectedSelector}`);
  console.log(`Match: ${selector === expectedSelector}`);
}

main().catch(console.error);
