/**
 * aave.js
 *
 * Script to perform various Aave V3 transactions on Sepolia.
 * Supports: supply, borrow, repay, withdraw, add-collateral, remove-collateral
 * This will create new events that can be indexed and proven for credit scoring.
 *
 * Usage:
 *   npm run aave               # supply (default)
 *   npm run aave supply [amount]
 *   npm run aave borrow [amount]
 *   npm run aave repay [amount]
 *   npm run aave withdraw [amount]
 *   npm run aave add-collateral [amount]   # add more collateral to enable borrowing
 *   npm run aave remove-collateral [amount] # remove collateral
 *
 * Environment variables:
 *   USE_ETH=true       # Use ETH instead of WETH
 *   USE_USDC=true      # Use USDC instead of WETH
 *
 * Note: Aave has minimum size requirements for borrow/withdraw operations.
 * Supply operations work reliably. Borrow/withdraw may require larger amounts.
 */

require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
  const { SEPOLIA_RPC, PRIVATE_KEY, AAVE_SEPOLIA_POOL, AAVE_SEPOLIA_USDC } = process.env;

  if (!SEPOLIA_RPC || !PRIVATE_KEY) {
    console.error("Missing required environment variables:");
    console.error("  SEPOLIA_RPC");
    console.error("  PRIVATE_KEY");
    process.exit(1);
  }

  if (!AAVE_SEPOLIA_POOL) {
    console.error("Missing required environment variable:");
    console.error("  AAVE_SEPOLIA_POOL");
    console.error("\nAdd it to your .env file with the Aave V3 Pool address on Sepolia.");
    process.exit(1);
  }

  // Get operation type from command line argument
  const operation = process.argv[2] || 'supply';
  const validOperations = ['supply', 'borrow', 'repay', 'withdraw', 'add-collateral', 'remove-collateral'];
  
  if (!validOperations.includes(operation)) {
    console.error(`Invalid operation: ${operation}`);
    console.error(`Valid operations: ${validOperations.join(', ')}`);
    process.exit(1);
  }

  // Aave V3 Pool on Sepolia
  const AAVE_POOL_ADDRESS = AAVE_SEPOLIA_POOL;

  // WETHGateway on Sepolia (for ETH operations)
  const AAVE_WETHGATEWAY = "0x387d311e47e80b498169e6fb51d3193167d89f7d";

  // WETH address on Sepolia (from Aave address book)
  const WETH_ADDRESS = "0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c";

  // USDC address on Sepolia
  const USDC_ADDRESS = AAVE_SEPOLIA_USDC || "0x94a9d9ac8a22534e3faca9f4e7f2e2cf85d5e4c8";
  const USE_ETH = (process.env.USE_ETH || "false").toLowerCase() === "true";
  const USE_USDC = (process.env.USE_USDC || "false").toLowerCase() === "true";

  // For borrow/withdraw operations, use USDC by default on testnet as it has better liquidity
  let useUsdc = USE_USDC;
  if ((operation === 'borrow' || operation === 'withdraw') && !USE_ETH && !USE_USDC) {
    console.log("  💡 Switching to USDC for better testnet liquidity");
    useUsdc = true;
  }

  let ASSET, ASSET_LABEL, ASSET_DECIMALS, AMOUNT;

  // Check if amount is specified as third argument
  const customAmount = process.argv[3];
  
  if (useUsdc) {
    ASSET = USDC_ADDRESS;
    ASSET_LABEL = "USDC";
    ASSET_DECIMALS = 6;
    AMOUNT = customAmount || "1000000"; // 1 USDC default
  } else if (USE_ETH) {
    ASSET = null; // ETH is native
    ASSET_LABEL = "ETH";
    ASSET_DECIMALS = 18;
    AMOUNT = customAmount || "1000000000000000"; // 0.001 ETH default
  } else {
    ASSET = WETH_ADDRESS;
    ASSET_LABEL = "WETH";
    ASSET_DECIMALS = 18;
    AMOUNT = customAmount || "1000000000000000"; // 0.001 WETH default
  }

  console.log(`Performing ${operation} transaction to Aave V3 on Sepolia...`);
  console.log(`  Pool: ${AAVE_POOL_ADDRESS}`);
  console.log(`  Asset: ${ASSET_LABEL}`);
  console.log(`  Target Amount: ${USE_ETH ? ethers.formatEther(AMOUNT) : ethers.formatUnits(AMOUNT, ASSET_DECIMALS)} (will adjust based on balance)`);

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`  From wallet: ${wallet.address}`);

  console.log("\n✅ Aave script is properly configured and ready to execute.");
  console.log("Note: Ensure you have sufficient token balances before actual execution.");
  console.log("\nTo execute with ETH: USE_ETH=true npm run aave");
  console.log("To execute with WETH: USE_ETH=false npm run aave");

  try {
    let tx;

    switch (operation) {
      case 'supply':
        await handleSupply();
        break;
      case 'borrow':
        await handleBorrow();
        break;
      case 'repay':
        await handleRepay();
        break;
      case 'withdraw':
        await handleWithdraw();
        break;
      case 'add-collateral':
        await handleAddCollateral();
        break;
      case 'remove-collateral':
        await handleRemoveCollateral();
        break;
    }

    async function handleSupply() {
      if (USE_ETH) {
        console.log("\nStep 1: Depositing ETH via WETHGateway...");
        const ethBalance = await provider.getBalance(wallet.address);
        const formattedBalance = ethers.formatEther(ethBalance);
        console.log(`  ETH Balance: ${formattedBalance}`);

        if (ethBalance < BigInt(AMOUNT)) {
          console.log(`  ⚠️  Insufficient ETH balance, adjusting to: ${formattedBalance}`);
          AMOUNT = ethBalance.toString();
          if (ethBalance === 0n) {
            console.error("❌ No ETH balance available");
            process.exit(1);
          }
        }

        console.log(`  Final deposit amount: ${ethers.formatEther(AMOUNT)}`);

        const wethGateway = new ethers.Contract(
          AAVE_WETHGATEWAY,
          ["function depositETH(address, address onBehalfOf, uint16 referralCode) payable"],
          wallet
        );

        tx = await wethGateway.depositETH(ethers.ZeroAddress, wallet.address, 0, { value: AMOUNT });
      } else {
        console.log(`\nStep 1: Approving Pool to spend ${ASSET_LABEL}...`);
        const tokenContract = new ethers.Contract(
          ASSET,
          [
            "function balanceOf(address) view returns (uint256)",
            "function decimals() view returns (uint8)",
            "function approve(address spender, uint256 amount) returns (bool)",
            "function allowance(address owner, address spender) view returns (uint256)",
          ],
          provider
        );

        const balance = await tokenContract.balanceOf(wallet.address);
        const formattedBalance = ethers.formatUnits(balance, ASSET_DECIMALS);
        console.log(`  ${ASSET_LABEL} Balance: ${formattedBalance}`);

        if (balance < BigInt(AMOUNT)) {
          console.log(`  ⚠️  Insufficient balance, adjusting to: ${formattedBalance}`);
          AMOUNT = balance.toString();
          if (balance === 0n) {
            console.error(`❌ No ${ASSET_LABEL} balance available`);
            console.log(`\n💡 Tip: Use USE_ETH=true for ETH deposits, or get ${ASSET_LABEL} from a faucet`);
            process.exit(1);
          }
        }

        const currentAllowance = await tokenContract.allowance(wallet.address, AAVE_POOL_ADDRESS);
        if (currentAllowance < BigInt(AMOUNT)) {
          const tokenWithWallet = tokenContract.connect(wallet);
          const approveTx = await tokenWithWallet.approve(AAVE_POOL_ADDRESS, AMOUNT);
          console.log(`  Approval transaction: ${approveTx.hash}`);
          await approveTx.wait();
          console.log("  ✅ Approval confirmed");
        }

        console.log(`\nStep 2: Supplying ${ASSET_LABEL} to Aave Pool...`);
        const aavePool = new ethers.Contract(
          AAVE_POOL_ADDRESS,
          ["function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)"],
          wallet
        );

        tx = await aavePool.supply(ASSET, AMOUNT, wallet.address, 0);
      }
    }

    async function handleBorrow() {
      console.log("\nStep 1: Borrowing from Aave Pool...");
      const aavePool = new ethers.Contract(
        AAVE_POOL_ADDRESS,
        [
          "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)",
          "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)"
        ],
        wallet
      );

      // Check available borrow capacity
      const userData = await aavePool.getUserAccountData(wallet.address);
      const availableBorrowsUSD = ethers.formatUnits(userData.availableBorrowsBase, 8); // Base currency is USD with 8 decimals
      const healthFactor = ethers.formatUnits(userData.healthFactor, 18);
      console.log(`  Available to borrow: $${availableBorrowsUSD} USD (base units)`);
      console.log(`  Health factor: ${healthFactor}`);

      if (userData.availableBorrowsBase === 0n) {
        console.error("❌ No borrow capacity available");
        console.log("\n💡 Tip: Supply more collateral first with: npm run aave:add-collateral");
        process.exit(1);
      }

      // Always use USDC for borrowing on testnet (better liquidity and minimum borrow amounts)
      const borrowAsset = USDC_ADDRESS;
      const borrowAssetLabel = "USDC";
      const borrowDecimals = 6;

      // Default to 1 USDC if no amount specified
      let borrowAmount = AMOUNT;
      if (!customAmount) {
        borrowAmount = "1000000"; // 1 USDC default
      }

      // For USDC, we need to convert the USD-based availableBorrowsBase to USDC amount
      // Since both are USD-based, we can use availableBorrowsBase directly as a rough guide
      // But we should use a reasonable minimum - let's use at least 1 USDC
      const minBorrowAmount = BigInt("1000000"); // 1 USDC minimum
      
      if (BigInt(borrowAmount) < minBorrowAmount) {
        console.log(`  ⚠️  Borrow amount too small, adjusting to minimum 1 USDC`);
        borrowAmount = minBorrowAmount.toString();
      }

      console.log(`  Borrow amount: ${ethers.formatUnits(borrowAmount, borrowDecimals)} ${borrowAssetLabel}`);

      try {
        tx = await aavePool.borrow(borrowAsset, borrowAmount, 2, 0, wallet.address);
      } catch (error) {
        console.error("❌ Borrow failed:", error.message);
        console.log("\n💡 Possible reasons:");
        console.log("  1. Borrow amount too small (minimum borrow requirements)");
        console.log("  2. Insufficient health factor after borrow");
        console.log("  3. Borrow is not enabled for this asset");
        console.log("\n💡 Tip: Try supplying more collateral first");
        process.exit(1);
      }
    }

    async function handleRepay() {
      console.log("\nStep 1: Repaying to Aave Pool...");
      const aavePool = new ethers.Contract(
        AAVE_POOL_ADDRESS,
        [
          "function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf)",
          "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
          "function getReserveData(address asset) view returns (tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))"
        ],
        wallet
      );

      // Check debt (using USD-based totalDebtBase for display)
      const userData = await aavePool.getUserAccountData(wallet.address);
      const totalDebtUSD = ethers.formatUnits(userData.totalDebtBase, 8); // USD with 8 decimals
      console.log(`  Total debt: $${totalDebtUSD} USD (base units)`);

      if (userData.totalDebtBase === 0n) {
        console.error("❌ No debt to repay");
        console.log("\n💡 Tip: Borrow first with: npm run aave:borrow");
        process.exit(1);
      }

      // Always use USDC for repayment (matching what we borrowed)
      const repayAsset = USDC_ADDRESS;
      const repayAssetLabel = "USDC";
      const repayDecimals = 6;

      // Get the actual debt token balance
      const reserveData = await aavePool.getReserveData(USDC_ADDRESS);
      const variableDebtTokenAddress = reserveData.variableDebtTokenAddress;
      
      const debtToken = new ethers.Contract(
        variableDebtTokenAddress,
        ["function balanceOf(address) view returns (uint256)"],
        provider
      );

      const actualDebtRaw = await debtToken.balanceOf(wallet.address);
      const actualDebt = ethers.formatUnits(actualDebtRaw, repayDecimals);
      console.log(`  Actual USDC debt: ${actualDebt} USDC`);

      // Default to 1 USDC if no amount specified
      let repayAmount = AMOUNT;
      if (!customAmount) {
        repayAmount = "1000000"; // 1 USDC default
      }

      // If debt is less than requested, use the actual debt amount
      if (actualDebtRaw < BigInt(repayAmount)) {
        console.log(`  ⚠️  Repay amount exceeds debt, adjusting to full debt`);
        repayAmount = actualDebtRaw;
      }

      console.log(`  Repay amount: ${ethers.formatUnits(repayAmount, repayDecimals)} ${repayAssetLabel}`);

      // Approve USDC spending
      const usdcContract = new ethers.Contract(
        USDC_ADDRESS,
        [
          "function approve(address spender, uint256 amount) returns (bool)",
          "function allowance(address owner, address spender) view returns (uint256)",
        ],
        provider
      );

      const currentAllowance = await usdcContract.allowance(wallet.address, AAVE_POOL_ADDRESS);
      if (currentAllowance < BigInt(repayAmount)) {
        const tokenWithWallet = usdcContract.connect(wallet);
        const approveTx = await tokenWithWallet.approve(AAVE_POOL_ADDRESS, repayAmount);
        console.log(`  Approval transaction: ${approveTx.hash}`);
        await approveTx.wait();
        console.log("  ✅ Approval confirmed");
      }

      tx = await aavePool.repay(repayAsset, repayAmount, 2, wallet.address);
    }

    async function handleWithdraw() {
      console.log("\nStep 1: Withdrawing from Aave Pool...");
      
      const aavePool = new ethers.Contract(
        AAVE_POOL_ADDRESS,
        [
          "function withdraw(address asset, uint256 amount, address to)",
          "function getReserveData(address asset) view returns (tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))"
        ],
        wallet
      );

      // Get the aToken address for the asset we're withdrawing
      const withdrawAsset = WETH_ADDRESS;
      const withdrawAssetLabel = "WETH";
      const withdrawDecimals = 18;

      const reserveData = await aavePool.getReserveData(withdrawAsset);
      const aTokenAddress = reserveData.aTokenAddress;

      // Check actual aToken balance (real collateral amount)
      const aToken = new ethers.Contract(
        aTokenAddress,
        ["function balanceOf(address) view returns (uint256)"],
        provider
      );

      const realCollateralRaw = await aToken.balanceOf(wallet.address);
      const realCollateral = ethers.formatUnits(realCollateralRaw, withdrawDecimals);
      console.log(`  Real collateral (aToken balance): ${realCollateral} ${withdrawAssetLabel}`);

      if (realCollateralRaw === 0n) {
        console.error("❌ No collateral to withdraw");
        console.log("\n💡 Tip: Supply collateral first with: npm run aave:supply");
        process.exit(1);
      }

      let withdrawAmount = AMOUNT;
      if (realCollateralRaw < BigInt(withdrawAmount)) {
        console.log(`  ⚠️  Withdraw amount exceeds collateral, adjusting to full collateral`);
        withdrawAmount = realCollateralRaw;
      }

      console.log(`  Withdraw amount: ${ethers.formatUnits(withdrawAmount, withdrawDecimals)} ${withdrawAssetLabel}`);
      console.log(`  Note: Withdrawing as WETH. You can unwrap to ETH afterwards if needed.`);

      try {
        tx = await aavePool.withdraw(withdrawAsset, withdrawAmount, wallet.address);
      } catch (error) {
        console.error("❌ Withdraw failed:", error.message);
        console.log("\n💡 Possible reasons:");
        console.log("  1. Withdraw amount too small");
        console.log("  2. Health factor would be too low after withdraw");
        console.log("  3. No collateral available");
        process.exit(1);
      }
    }

    async function handleAddCollateral() {
      console.log("\nStep 1: Adding more collateral (Supply) to Aave Pool...");
      // This is essentially the same as supply, just with a clearer name
      await handleSupply();
    }

    async function handleRemoveCollateral() {
      console.log("\nStep 1: Removing collateral (Withdraw) from Aave Pool...");
      // Use the same withdraw function for both ETH and WETH
      await handleWithdraw();
    }

    console.log(`  Transaction: ${tx.hash}`);
    console.log("  Waiting for confirmation...");

    const receipt = await tx.wait();
    
    if (receipt.status === 0) {
      console.error(`❌ Transaction failed on-chain`);
      console.error(`  Transaction hash: ${tx.hash}`);
      console.error(`  Block: ${receipt.blockNumber}`);
      console.error(`  Gas used: ${receipt.gasUsed.toString()}`);
      process.exit(1);
    }
    
    console.log(`  ✅ ${operation.charAt(0).toUpperCase() + operation.slice(1)} confirmed in block ${receipt.blockNumber}`);
    console.log(`  Gas used: ${receipt.gasUsed.toString()}`);

    console.log(`\n✅ ${operation.charAt(0).toUpperCase() + operation.slice(1)} transaction completed successfully!`);
    console.log("\nNext steps:");
    console.log("1. Wait for the indexer to pick up this transaction (usually within a few minutes)");
    console.log("2. Run: npm run prove-queue");
    console.log(`3. This will be classified as "${operation.charAt(0).toUpperCase() + operation.slice(1)}" for credit scoring`);
  } catch (error) {
    console.error(`❌ Error performing ${operation}:`, error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
