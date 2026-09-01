/**
 * compound.js
 *
 * Script to perform various Compound Comet transactions on Sepolia.
 * Supports: supply, withdraw
 * This will create new events that can be indexed and proven for credit scoring.
 *
 * IMPORTANT — event classification (see indexer/src/compoundDecoder.js):
 *   Comet only exposes Supply/Withdraw events. Whether an event counts as
 *   "Supply" or "Repay" (and "Withdraw" or "Borrow") depends on which asset
 *   is being moved:
 *     - Supply of the BASE asset (USDC on this market)      -> classified as Repay
 *     - Supply of a COLLATERAL asset (e.g. WETH)             -> classified as Supply
 *     - Withdraw of the BASE asset (borrowing against collat)-> classified as Borrow
 *     - Withdraw of a COLLATERAL asset                       -> classified as Withdraw
 *
 *   This script defaults to supplying WETH as collateral so it registers as a
 *   genuine "Supply" event. Set USE_BASE_ASSET=true to instead supply USDC
 *   (base asset), which will register as "Repay".
 *
 * Usage:
 *   npm run compound               # supply (default)
 *   npm run compound supply
 *   npm run compound withdraw
 *
 * Set USE_BASE_ASSET=true to use USDC (base asset) instead of WETH (collateral)
 */

require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
  const { SEPOLIA_RPC, PRIVATE_KEY, TARGET_WALLET, COMPOUND_SEPOLIA_COMET_USDC } = process.env;

  if (!SEPOLIA_RPC || !PRIVATE_KEY) {
    console.error("Missing required environment variables:");
    console.error("  SEPOLIA_RPC");
    console.error("  PRIVATE_KEY");
    process.exit(1);
  }

  if (!COMPOUND_SEPOLIA_COMET_USDC) {
    console.error("Missing required environment variable:");
    console.error("  COMPOUND_SEPOLIA_COMET_USDC");
    console.error("\nAdd it to your .env file with the Compound Comet USDC address on Sepolia.");
    process.exit(1);
  }

  // Get operation type from command line argument
  const operation = process.argv[2] || 'supply';
  const validOperations = ['supply', 'withdraw'];
  
  if (!validOperations.includes(operation)) {
    console.error(`Invalid operation: ${operation}`);
    console.error(`Valid operations: ${validOperations.join(', ')}`);
    process.exit(1);
  }

  // Compound Comet (USDC market) on Sepolia
  const COMET_ADDRESS = COMPOUND_SEPOLIA_COMET_USDC;

  // Base asset for this Comet market (USDC) — supplying this = "Repay" per app classification
  const BASE_ASSET_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

  // A collateral asset accepted by this Comet market — supplying this = "Supply"
  // WETH on Sepolia (commonly used as Comet collateral)
  const COLLATERAL_WETH = "0xfff9976782d46cc05630d34fae175e5c0be1995d";

  // Toggle: supply base asset (Repay) vs. collateral asset (Supply)
  const USE_BASE_ASSET = (process.env.USE_BASE_ASSET || "true").toLowerCase() === "true";

  const ASSET = USE_BASE_ASSET ? BASE_ASSET_USDC : COLLATERAL_WETH;
  const ASSET_LABEL = USE_BASE_ASSET ? "USDC (base asset -> Repay)" : "WETH (collateral -> Supply)";
  const ASSET_DECIMALS = USE_BASE_ASSET ? 6 : 18;

  // Amount (will be adjusted based on available balance)
  let AMOUNT = USE_BASE_ASSET
    ? "1000000" // 1 USDC (6 decimals)
    : "1000000000000000"; // 0.001 WETH (18 decimals)

  console.log(`Performing ${operation} transaction to Compound Comet on Sepolia...`);
  console.log(`  Comet market: ${COMET_ADDRESS}`);
  console.log(`  Asset: ${ASSET_LABEL} (${ASSET})`);
  console.log(`  Target Amount: ${ethers.formatUnits(AMOUNT, ASSET_DECIMALS)} (will adjust based on balance)`);

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`  From wallet: ${wallet.address}`);
  if (TARGET_WALLET) {
    console.log(`  Credit will go to: ${TARGET_WALLET}`);
  }

  console.log("\n✅ Compound script is properly configured and ready to execute.");
  console.log("Note: Ensure you have sufficient token balances before actual execution.");
  console.log("\nTo execute with base asset (Repay): USE_BASE_ASSET=true npm run compound");
  console.log("To execute with collateral asset (Supply): USE_BASE_ASSET=false npm run compound");

  try {
    // Check if asset is WETH (native ETH wrapper)
    const WETH_ADDRESS = "0xfff9976782d46cc05630d34fae175e5c0be1995d";
    const isWETH = ASSET.toLowerCase() === WETH_ADDRESS.toLowerCase();

    let tx;

    switch (operation) {
      case 'supply':
        await handleSupply();
        break;
      case 'withdraw':
        await handleWithdraw();
        break;
    }

    async function handleSupply() {
      let balance;
      if (isWETH) {
        // For WETH, check ETH balance directly
        balance = await provider.getBalance(wallet.address);
        console.log(`  Using ETH balance (WETH is wrapped ETH on Sepolia)`);
      } else {
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
        balance = await tokenContract.balanceOf(wallet.address);
      }

      const formattedBalance = ethers.formatUnits(balance, ASSET_DECIMALS);
      console.log(`  Balance: ${formattedBalance}`);

      if (balance < BigInt(AMOUNT)) {
        console.log(`  ⚠️  Insufficient balance for full supply (need ${ethers.formatUnits(AMOUNT, ASSET_DECIMALS)})`);
        console.log(`  🔧 Adjusting supply amount to available balance: ${formattedBalance}`);
        AMOUNT = balance.toString();

        if (balance === 0n) {
          console.error(`❌ No ${ASSET_LABEL} balance available for supply`);
          console.log("\nOptions:");
          console.log("1. Get testnet tokens from a faucet");
          console.log("2. Set USE_BASE_ASSET=true/false to try the other asset");
          process.exit(1);
        }
      }

      console.log(`  Final supply amount: ${ethers.formatUnits(AMOUNT, ASSET_DECIMALS)}`);

      // Approve Comet to spend the asset (skip for WETH as it wraps ETH)
      if (!isWETH) {
        console.log("\nStep 1: Approving Comet to spend asset...");
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

        const currentAllowance = await tokenContract.allowance(wallet.address, COMET_ADDRESS);
        console.log(`  Current allowance: ${ethers.formatUnits(currentAllowance, ASSET_DECIMALS)}`);

        if (currentAllowance >= BigInt(AMOUNT)) {
          console.log("  ✅ Sufficient allowance already exists, skipping approval");
        } else {
          const tokenWithWallet = tokenContract.connect(wallet);
          const approveTx = await tokenWithWallet.approve(COMET_ADDRESS, AMOUNT);
          console.log(`  Approval transaction: ${approveTx.hash}`);
          await approveTx.wait();
          console.log("  ✅ Approval confirmed");
        }
      } else {
        console.log("\nStep 1: Skipping approval (WETH wraps ETH directly)");
      }

      // Supply to Comet
      console.log("\nStep 2: Supplying to Compound Comet...");
      const comet = new ethers.Contract(
        COMET_ADDRESS,
        ["function supply(address asset, uint256 amount)"],
        wallet
      );

      tx = await comet.supply(ASSET, AMOUNT);
    }

    async function handleWithdraw() {
      console.log("\nStep 1: Withdrawing from Compound Comet...");
      const comet = new ethers.Contract(
        COMET_ADDRESS,
        [
          "function withdraw(address asset, uint256 amount)",
          "function allow(address asset, bool true)",
          "function userCollateral(address user, address asset) view returns (uint256)"
        ],
        wallet
      );

      // Check available collateral
      const collateral = await comet.userCollateral(wallet.address, ASSET);
      const formattedCollateral = ethers.formatUnits(collateral, ASSET_DECIMALS);
      console.log(`  Available collateral: ${formattedCollateral}`);

      if (collateral === 0n) {
        console.error("❌ No collateral to withdraw");
        process.exit(1);
      }

      if (collateral < BigInt(AMOUNT)) {
        console.log(`  ⚠️  Withdraw amount exceeds collateral, adjusting to full collateral`);
        AMOUNT = collateral.toString();
      }

      console.log(`  Withdraw amount: ${ethers.formatUnits(AMOUNT, ASSET_DECIMALS)}`);

      // Enable withdrawal
      console.log("  Enabling withdrawal...");
      await comet.allow(ASSET, true);

      tx = await comet.withdraw(ASSET, AMOUNT);
    }

    console.log(`  Transaction: ${tx.hash}`);
    console.log("  Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log(`  ✅ ${operation.charAt(0).toUpperCase() + operation.slice(1)} confirmed in block ${receipt.blockNumber}`);
    console.log(`  Gas used: ${receipt.gasUsed.toString()}`);

    console.log(`\n✅ ${operation.charAt(0).toUpperCase() + operation.slice(1)} transaction completed successfully!`);
    console.log("\nNext steps:");
    console.log("1. Wait for the indexer to pick up this transaction (usually within a few minutes)");
    console.log("2. Run: npm run prove-queue");
    console.log(`3. This will be classified as "${USE_BASE_ASSET ? "Repay" : "Supply"}" for credit scoring`);
  } catch (error) {
    console.error(`❌ Error performing ${operation}:`, error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
