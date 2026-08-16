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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
