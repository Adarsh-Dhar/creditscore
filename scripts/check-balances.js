/**
 * check-balances.js
 * 
 * Script to check balances of common tokens on Sepolia
 * Usage: node scripts/check-balances.js
 */

require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
  const { SEPOLIA_RPC, PRIVATE_KEY, TARGET_WALLET } = process.env;

  if (!SEPOLIA_RPC || !PRIVATE_KEY) {
    console.error("Missing required environment variables:");
    console.error("  SEPOLIA_RPC");
    console.error("  PRIVATE_KEY");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  // Common tokens on Sepolia (addresses from Aave Sepolia market)
  const tokens = [
    { name: "USDC", address: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238", decimals: 6 },
    { name: "USDT", address: "0x7169c3823681DDf810325Bc5F520e7e5F8cB7236", decimals: 6 },
    { name: "DAI", address: "0x31F42841c3db5176DaC8d451Ca68D78C7dA9747D", decimals: 18 },
    { name: "WETH", address: "0xfFf9976782d46CC05630D34fAe175e5C0Be1995d", decimals: 18 },
    { name: "LINK", address: "0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5", decimals: 18 },
    { name: "WBTC", address: "0x29f2D48B8792bF4e999b3cE2F177701684084AB5", decimals: 8 },
  ];

  console.log(`Checking balances for wallet: ${wallet.address}\n`);

  // If TARGET_WALLET is set, check that wallet first
  const targetWallet = TARGET_WALLET || "0xFe5e03799Fe833D93e950d22406F9aD901Ff3Bb9";
  if (TARGET_WALLET || process.argv.includes("--target")) {
    console.log(`--- TARGET_WALLET Balances (${targetWallet}) ---`);
    const targetEthBalance = await provider.getBalance(targetWallet);
    console.log(`ETH: ${ethers.formatEther(targetEthBalance)} ETH`);

    for (const token of tokens) {
      try {
        const tokenContract = new ethers.Contract(
          token.address,
          ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"],
          provider
        );

        const balance = await tokenContract.balanceOf(targetWallet);
        const formattedBalance = ethers.formatUnits(balance, token.decimals);

        if (balance > 0n) {
          console.log(`${token.name}: ${formattedBalance} ${token.name} ✅`);
        } else {
          console.log(`${token.name}: 0.0 ${token.name}`);
        }
      } catch (error) {
        console.log(`${token.name}: Error checking balance - ${error.message}`);
      }
    }
    console.log("\n");
  }

  // Check ETH balance
  const ethBalance = await provider.getBalance(wallet.address);
  console.log(`ETH: ${ethers.formatEther(ethBalance)} ETH`);

  // Check token balances
  for (const token of tokens) {
    try {
      const tokenContract = new ethers.Contract(
        token.address,
        ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"],
        provider
      );

      const balance = await tokenContract.balanceOf(wallet.address);
      const formattedBalance = ethers.formatUnits(balance, token.decimals);

      if (balance > 0n) {
        console.log(`${token.name}: ${formattedBalance} ${token.name} ✅`);
      } else {
        console.log(`${token.name}: 0.0 ${token.name}`);
      }
    } catch (error) {
      console.log(`${token.name}: Error checking balance - ${error.message}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
