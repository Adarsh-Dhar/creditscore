const hre = require("hardhat");

async function main() {
  console.log("Deploying CreditScoreMVP to CC3 Testnet...");

  // First deploy the required library
  console.log("Deploying EvmV1Decoder library...");
  const EvmV1Decoder = await hre.ethers.deployContract("@gluwa/usc-contracts/contracts/decoding/EvmV1Decoder.sol:EvmV1Decoder");
  await EvmV1Decoder.waitForDeployment();
  const libraryAddress = await EvmV1Decoder.getAddress();
  console.log("EvmV1Decoder deployed to:", libraryAddress);

  // Deploy the main contract with linked library
  console.log("Deploying CreditScoreMVP with linked library...");
  const CreditScoreMVP = await hre.ethers.getContractFactory("CreditScoreMVP", {
    libraries: {
      "@gluwa/usc-contracts/contracts/decoding/EvmV1Decoder.sol:EvmV1Decoder": libraryAddress
    }
  });
  
  const contract = await CreditScoreMVP.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("CreditScoreMVP deployed to:", address);
  console.log("\nAdd this to your .env file:");
  console.log(`CONTRACT_ADDRESS=${address}`);
  
  // Verify the owner
  const owner = await contract.owner();
  console.log(`Contract owner: ${owner}`);

  // Set pool addresses for Sepolia (chainKey=1)
  console.log("\nSetting pool addresses for Sepolia...");
  const sepoliaChainKey = 1;

  // Aave Pool on Sepolia
  const aavePoolAddress = "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951";
  await contract.setPoolAddress(sepoliaChainKey, 0, aavePoolAddress);
  console.log(`✓ Aave Pool address set: ${aavePoolAddress}`);

  // Compound Pool on Sepolia
  const compoundPoolAddress = "0xc3d688B66703497DAA19211EEdff47f25384cdc3";
  await contract.setPoolAddress(sepoliaChainKey, 1, compoundPoolAddress);
  console.log(`✓ Compound Pool address set: ${compoundPoolAddress}`);

  // Morpho Pool on Sepolia
  const morphoPoolAddress = "0xd011EE229E7459ba1ddd22631eF7bF528d424A14";
  await contract.setPoolAddress(sepoliaChainKey, 2, morphoPoolAddress);
  console.log(`✓ Morpho Pool address set: ${morphoPoolAddress}`);

  // Aave WETHGateway on Sepolia
  const aaveWethGatewayAddress = "0x387d311e47e80b498169e6fb51d3193167d89F7D";
  await contract.setWETHGatewayAddress(sepoliaChainKey, 0, aaveWethGatewayAddress);
  console.log(`✓ Aave WETHGateway address set: ${aaveWethGatewayAddress}`);

  console.log("\n=== Deployment complete ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
