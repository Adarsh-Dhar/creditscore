/**
 * checkCollateral.js
 *
 * Read-only script to check Aave position without executing transactions.
 * Calls Aave's getUserAccountData() to get collateral, debt, and borrow capacity.
 * Also shows wallet balances for context.
 *
 * Usage:
 *   npm run aave:check-collateral              # check own wallet
 *   npm run aave:check-collateral 0xAddress # check any address
 */

require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
  const { SEPOLIA_RPC, PRIVATE_KEY, AAVE_SEPOLIA_POOL } = process.env;

  if (!SEPOLIA_RPC) {
    console.error("Missing required environment variable: SEPOLIA_RPC");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  
  // Get address to check (from CLI arg or PRIVATE_KEY)
  const targetAddress = process.argv[2];
  let walletAddress;
  
  if (targetAddress) {
    // Validate address format
    if (!ethers.isAddress(targetAddress)) {
      console.error(`Invalid address: ${targetAddress}`);
      process.exit(1);
    }
    walletAddress = targetAddress;
  } else if (PRIVATE_KEY) {
    const wallet = new ethers.Wallet(PRIVATE_KEY);
    walletAddress = wallet.address;
  } else {
    console.error("No address specified. Set PRIVATE_KEY in .env or provide address as argument.");
    process.exit(1);
  }

  if (!AAVE_SEPOLIA_POOL) {
    console.error("Missing required environment variable: AAVE_SEPOLIA_POOL");
    process.exit(1);
  }

  console.log("=== Aave Collateral Check ===");
  console.log(`Wallet: ${walletAddress}`);
  console.log(`Pool: ${AAVE_SEPOLIA_POOL}`);
  console.log(`Network: Sepolia`);
  console.log("");

  // Aave contract
  const aavePool = new ethers.Contract(
    AAVE_SEPOLIA_POOL,
    [
      "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)"
    ],
    provider
  );

  try {
    // Get Aave position data
    const userData = await aavePool.getUserAccountData(walletAddress);
    
    const totalCollateral = ethers.formatUnits(userData.totalCollateralBase, 18);
    const totalDebt = ethers.formatUnits(userData.totalDebtBase, 18);
    const availableBorrows = ethers.formatUnits(userData.availableBorrowsBase, 18);
    const ltv = ethers.formatUnits(userData.ltv, 16);
    const liquidationThreshold = ethers.formatUnits(userData.currentLiquidationThreshold, 16);
    const healthFactor = ethers.formatUnits(userData.healthFactor, 18);

    console.log("📊 Aave Position:");
    console.log(`  Total Collateral: ${totalCollateral} WETH (base units)`);
    console.log(`  Total Debt: ${totalDebt} WETH (base units)`);
    console.log(`  Available to Borrow: ${availableBorrows} WETH (base units)`);
    console.log(`  LTV: ${ltv}%`);
    console.log(`  Liquidation Threshold: ${liquidationThreshold}%`);
    console.log(`  Health Factor: ${healthFactor}`);
    console.log("");

    // Check wallet balances
    const ethBalance = await provider.getBalance(walletAddress);
    console.log("💰 Wallet Balances:");
    console.log(`  ETH: ${ethers.formatEther(ethBalance)}`);

    // WETH balance
    const WETH_ADDRESS = "0xfff9976782d46cc05630d34fae175e5c0be1995d";
    try {
      const wethContract = new ethers.Contract(
        WETH_ADDRESS,
        ["function balanceOf(address) view returns (uint256)"],
        provider
      );
      const wethBalance = await wethContract.balanceOf(walletAddress);
      console.log(`  WETH: ${ethers.formatEther(wethBalance)}`);
    } catch (e) {
      console.log(`  WETH: Not available`);
    }

    // USDC balance
    const USDC_ADDRESS = "0x94a9d9ac8a22534e3faca9f4e7f2e2cf85d5e4c8";
    try {
      const usdcContract = new ethers.Contract(
        USDC_ADDRESS,
        ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"],
        provider
      );
      const usdcBalance = await usdcContract.balanceOf(walletAddress);
      const decimals = await usdcContract.decimals();
      console.log(`  USDC: ${ethers.formatUnits(usdcBalance, decimals)}`);
    } catch (e) {
      console.log(`  USDC: Not available`);
    }

    console.log("");

    // Plain-language verdict
    console.log("� Next Steps:");
    
    if (parseFloat(totalCollateral) === 0) {
      console.log("  ❌ No collateral yet");
      console.log("  → Run: npm run aave:supply [amount]");
      console.log("  → Or: npm run aave:add-collateral [amount]");
    } else if (parseFloat(availableBorrows) === 0) {
      console.log("  ⚠️  Available borrow is 0");
      console.log("  → Run: npm run aave:add-collateral [amount] to increase borrow capacity");
    } else {
      console.log("  ✅ You can borrow!");
      console.log(`  → Available: ${availableBorrows} WETH`);
      console.log("  → Run: npm run aave:borrow [amount]");
    }

    if (parseFloat(totalDebt) > 0) {
      console.log("  📌 You have debt:");
      console.log(`  → Total: ${totalDebt} WETH`);
      console.log("  → Run: npm run aave:repay [amount] to reduce debt");
    }

    if (parseFloat(totalCollateral) > 0) {
      console.log("  💎 You have collateral:");
      console.log(`  → Total: ${totalCollateral} WETH`);
      console.log("  → Run: npm run aave:withdraw [amount] to remove collateral");
      console.log("  → Or: npm run aave:remove-collateral [amount]");
    }

  } catch (error) {
    console.error("❌ Error checking collateral:", error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
