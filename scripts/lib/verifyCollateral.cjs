/**
 * verifyCollateral.js
 *
 * Verification script to check the actual aToken balance (real WETH collateral)
 * versus the misleading totalCollateralBase from getUserAccountData.
 */

require("dotenv").config();
const { ethers } = require("ethers");
const fs = require('fs');

async function main() {
  const { SEPOLIA_RPC, PRIVATE_KEY, AAVE_SEPOLIA_POOL } = process.env;

  if (!SEPOLIA_RPC || !PRIVATE_KEY) {
    console.error("Missing required environment variables:");
    console.error("  SEPOLIA_RPC");
    console.error("  PRIVATE_KEY");
    process.exit(1);
  }

  if (!AAVE_SEPOLIA_POOL) {
    console.error("Missing required environment variable: AAVE_SEPOLIA_POOL");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const AAVE_POOL_ADDRESS = AAVE_SEPOLIA_POOL;
  const WETH_ADDRESS = "0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c";

  console.log("=== Aave Collateral Verification ===");
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Pool: ${AAVE_POOL_ADDRESS}`);
  console.log(`Network: Sepolia`);
  console.log("");

  let logs = [];

  logs.push("=== Aave Collateral Verification ===");
  logs.push(`Wallet: ${wallet.address}`);
  logs.push(`Pool: ${AAVE_POOL_ADDRESS}`);
  logs.push(`Network: Sepolia`);
  logs.push("");

  try {
    // 1. Check getUserAccountData (the misleading one)
    console.log("1. Checking getUserAccountData (misleading totalCollateralBase):");
    logs.push("1. Checking getUserAccountData (misleading totalCollateralBase):");
    
    const aavePool = new ethers.Contract(
      AAVE_POOL_ADDRESS,
      [
        "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)"
      ],
      provider
    );

    const userData = await aavePool.getUserAccountData(wallet.address);
    
    const totalCollateralBase = userData.totalCollateralBase.toString();
    const totalDebtBase = userData.totalDebtBase.toString();
    const availableBorrowsBase = userData.availableBorrowsBase.toString();
    
    console.log(`  totalCollateralBase (raw): ${totalCollateralBase}`);
    console.log(`  totalDebtBase (raw): ${totalDebtBase}`);
    console.log(`  availableBorrowsBase (raw): ${availableBorrowsBase}`);
    
    logs.push(`  totalCollateralBase (raw): ${totalCollateralBase}`);
    logs.push(`  totalDebtBase (raw): ${totalDebtBase}`);
    logs.push(`  availableBorrowsBase (raw): ${availableBorrowsBase}`);
    
    // This is what the current scripts wrongly treat as WETH amount
    const wrongCollateralAmount = ethers.formatUnits(userData.totalCollateralBase, 18);
    console.log(`  ❌ WRONG (formatted as 18 decimals): ${wrongCollateralAmount} "WETH"`);
    logs.push(`  ❌ WRONG (formatted as 18 decimals): ${wrongCollateralAmount} "WETH"`);
    console.log("");

    logs.push("");

    // 2. Get the aToken address for WETH
    console.log("2. Getting aToken address for WETH:");
    logs.push("2. Getting aToken address for WETH:");
    
    const poolWithReserveData = new ethers.Contract(
      AAVE_POOL_ADDRESS,
      [
        "function getReserveData(address asset) view returns (tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))"
      ],
      provider
    );

    const reserveData = await poolWithReserveData.getReserveData(WETH_ADDRESS);
    const aTokenAddress = reserveData.aTokenAddress;
    
    console.log(`  aToken address: ${aTokenAddress}`);
    logs.push(`  aToken address: ${aTokenAddress}`);
    console.log("");

    logs.push("");

    // 3. Check the actual aToken balance (the real WETH collateral)
    console.log("3. Checking actual aToken balance (REAL WETH collateral):");
    logs.push("3. Checking actual aToken balance (REAL WETH collateral):");
    
    const aToken = new ethers.Contract(
      aTokenAddress,
      ["function balanceOf(address) view returns (uint256)"],
      provider
    );

    const realCollateralRaw = await aToken.balanceOf(wallet.address);
    const realCollateral = ethers.formatEther(realCollateralRaw);
    
    console.log(`  aToken balance (raw): ${realCollateralRaw.toString()}`);
    console.log(`  ✅ REAL WETH collateral: ${realCollateral} WETH`);
    logs.push(`  aToken balance (raw): ${realCollateralRaw.toString()}`);
    logs.push(`  ✅ REAL WETH collateral: ${realCollateral} WETH`);
    console.log("");

    logs.push("");

    // 4. Comparison
    console.log("4. Comparison:");
    logs.push("4. Comparison:");
    console.log(`  Misleading amount (from totalCollateralBase): ${wrongCollateralAmount}`);
    console.log(`  Real collateral (from aToken balance): ${realCollateral}`);
    console.log(`  Difference: ${(parseFloat(realCollateral) - parseFloat(wrongCollateralAmount)).toFixed(18)} WETH`);
    logs.push(`  Misleading amount (from totalCollateralBase): ${wrongCollateralAmount}`);
    logs.push(`  Real collateral (from aToken balance): ${realCollateral}`);
    logs.push(`  Difference: ${(parseFloat(realCollateral) - parseFloat(wrongCollateralAmount)).toFixed(18)} WETH`);
    console.log("");

    logs.push("");

    // 5. Wallet balances
    console.log("5. Wallet balances:");
    logs.push("5. Wallet balances:");
    
    const ethBalance = await provider.getBalance(wallet.address);
    console.log(`  ETH: ${ethers.formatEther(ethBalance)}`);
    logs.push(`  ETH: ${ethers.formatEther(ethBalance)}`);

    try {
      const wethContract = new ethers.Contract(
        WETH_ADDRESS,
        ["function balanceOf(address) view returns (uint256)"],
        provider
      );
      const wethBalance = await wethContract.balanceOf(wallet.address);
      console.log(`  WETH: ${ethers.formatEther(wethBalance)}`);
      logs.push(`  WETH: ${ethers.formatEther(wethBalance)}`);
    } catch (e) {
      console.log(`  WETH: Not available`);
      logs.push(`  WETH: Not available`);
    }

    console.log("");
    logs.push("");

    // 6. Conclusion
    console.log("6. Conclusion:");
    logs.push("6. Conclusion:");
    
    if (parseFloat(realCollateral) > 0.001) {
      console.log(`  ⚠️  You still have ${realCollateral} WETH collateral in Aave!`);
      console.log(`  The remove-collateral transaction only withdrew the dust amount (${wrongCollateralAmount})`);
      console.log(`  Your real collateral is still in the pool.`);
      logs.push(`  ⚠️  You still have ${realCollateral} WETH collateral in Aave!`);
      logs.push(`  The remove-collateral transaction only withdrew the dust amount (${wrongCollateralAmount})`);
      logs.push(`  Your real collateral is still in the pool.`);
    } else {
      console.log(`  ✅ Collateral has been properly withdrawn.`);
      logs.push(`  ✅ Collateral has been properly withdrawn.`);
    }

    // Write logs to file
    fs.writeFileSync('/Users/adarsh/Documents/creditscore/collateral_verification.txt', logs.join('\n'));
    console.log("\n✅ Logs written to: /Users/adarsh/Documents/creditscore/collateral_verification.txt");

  } catch (error) {
    console.error("❌ Error:", error.message);
    logs.push(`❌ Error: ${error.message}`);
    fs.writeFileSync('/Users/adarsh/Documents/creditscore/collateral_verification.txt', logs.join('\n'));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
