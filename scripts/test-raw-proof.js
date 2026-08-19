require("dotenv").config();
const { ethers } = require("ethers");
const { chainInfo, proofProvider } = require("@gluwa/usc-sdk");

const SEPOLIA_RPC = process.env.SEPOLIA_RPC;
const CC3_TESTNET_RPC = process.env.CC3_TESTNET_RPC;
const COMPOUND_TX = "0x68c7996b55842d8195c3d41f8d0d0b7c771a77ae7e18c180f4a5effe53dbc607";

async function testRawProof() {
  console.log("Testing raw proof generation...");
  
  const sourceProvider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const creditcoinProvider = new ethers.JsonRpcProvider(CC3_TESTNET_RPC);
  
  // Get chain key
  const chainInfoProvider = new chainInfo.PrecompileChainInfoProvider(creditcoinProvider);
  const supportedChains = await chainInfoProvider.getSupportedChains();
  const chainEntry = supportedChains.find((c) => c.chainId === 11155111);
  const chainKey = chainEntry.chainKey;
  
  console.log(`Chain key: ${chainKey}`);
  
  // Try to use raw proof generator
  try {
    const { EncodingVersion } = require("@gluwa/usc-sdk/encoding");
    const { raw } = require("@gluwa/usc-sdk/proofGenerator");
    
    console.log("Raw proof generator available");
    
    const blockProvider = new raw.blockProvider.SimpleBlockProvider(sourceProvider);
    const rawGenerator = new raw.RawProofGenerator(
      chainKey,
      blockProvider,
      chainInfoProvider,
      EncodingVersion.V1,
    );
    
    const result = await rawGenerator.generateProof(COMPOUND_TX);
    console.log("Raw proof generated successfully");
    console.log(`txBytes length: ${result.txBytes.length}`);
    
  } catch (error) {
    console.log(`Raw proof generator error: ${error.message}`);
    console.log("Raw proof generator not available or failed");
  }
}

testRawProof().catch(console.error);
