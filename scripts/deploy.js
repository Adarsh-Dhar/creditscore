const hre = require("hardhat");

async function main() {
  console.log("Deploying CreditScoreMVP to CC3 Testnet...");

  const CreditScoreMVP = await hre.ethers.getContractFactory("CreditScoreMVP");
  const contract = await CreditScoreMVP.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("CreditScoreMVP deployed to:", address);
  console.log("\nAdd this to your .env file:");
  console.log(`CONTRACT_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
