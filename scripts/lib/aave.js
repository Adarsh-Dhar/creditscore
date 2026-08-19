/**
 * supply-to-aave.js
 *
 * Script to perform a supply transaction to Aave V3 on Sepolia.
 * This will create a new event that can be indexed and proven for credit scoring.
 *
 * Aave V3 has both direct Pool operations and WETHGateway for ETH operations:
 *   - Direct Pool: supply(address asset, uint256 amount) - for ERC20 tokens
 *   - WETHGateway: depositETH(uint16 referralCode) - for ETH deposits
 *
 * This script defaults to supplying USDC via the Pool. Set USE_ETH=true to deposit
 * ETH via WETHGateway instead.
 *
 * Usage: node scripts/lib/aave.js
 */

require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
  const { SEPOLIA_RPC, PRIVATE_KEY, TARGET_WALLET, AAVE_SEPOLIA_POOL, AAVE_SEPOLIA_USDC } = process.env;

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

  // Aave V3 Pool on Sepolia
  const AAVE_POOL_ADDRESS = AAVE_SEPOLIA_POOL;

  // WETHGateway on Sepolia (for ETH deposits)
  const AAVE_WETHGATEWAY = "0x387d311e47e80b498169e6fb51d3193167d89f7d";

  // Default to WETH as it's more likely to be supported
  const WETH_ADDRESS = "0xfff9976782d46cc05630d34fae175e5c0be1995d";

  // USDC address on Sepolia (may not be supported, use WETH instead)
  const USDC_ADDRESS = AAVE_SEPOLIA_USDC || "0x94a9d9ac8a22534e3faca9f4e7f2e2cf85d5e4c8";
  const USE_ETH = (process.env.USE_ETH || "false").toLowerCase() === "true";

  let ASSET, ASSET_LABEL, ASSET_DECIMALS, SUPPLY_AMOUNT, SUPPLY_FUNCTION;

  if (USE_ETH) {
    ASSET = null; // ETH is native
    ASSET_LABEL = "ETH (via WETHGateway)";
    ASSET_DECIMALS = 18;
    SUPPLY_AMOUNT = "1000000000000000"; // 0.001 ETH
    SUPPLY_FUNCTION = "depositETH";
  } else {
    ASSET = WETH_ADDRESS;
    ASSET_LABEL = "WETH (via Pool)";
    ASSET_DECIMALS = 18;
    SUPPLY_AMOUNT = "1000000000000000"; // 0.001 WETH
    SUPPLY_FUNCTION = "supply";
  }

  console.log("Performing supply transaction to Aave V3 on Sepolia...");
  console.log(`  Pool: ${AAVE_POOL_ADDRESS}`);
  console.log(`  Asset: ${ASSET_LABEL}`);
  console.log(`  Target Amount: ${USE_ETH ? ethers.formatEther(SUPPLY_AMOUNT) : ethers.formatUnits(SUPPLY_AMOUNT, ASSET_DECIMALS)} (will adjust based on balance)`);

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`  From wallet: ${wallet.address}`);
  if (TARGET_WALLET) {
    console.log(`  Credit will go to: ${TARGET_WALLET}`);
  }

  console.log("\n✅ Aave script is properly configured and ready to execute.");
  console.log("Note: Ensure you have sufficient token balances before actual execution.");
  console.log("\nTo execute with ETH: USE_ETH=true npm run aave");
  console.log("To execute with WETH: USE_ETH=false npm run aave");

  try {
    let supplyTx;

    if (USE_ETH) {
      // ETH deposit via WETHGateway
      console.log("\nStep 1: Depositing ETH via WETHGateway...");

      const ethBalance = await provider.getBalance(wallet.address);
      const formattedBalance = ethers.formatEther(ethBalance);
      console.log(`  ETH Balance: ${formattedBalance}`);

      if (ethBalance < BigInt(SUPPLY_AMOUNT)) {
        console.log(`  ⚠️  Insufficient ETH balance (need ${ethers.formatEther(SUPPLY_AMOUNT)})`);
        console.log(`  🔧 Adjusting deposit amount to available balance: ${formattedBalance}`);
        SUPPLY_AMOUNT = ethBalance.toString();

        if (ethBalance === 0n) {
          console.error("❌ No ETH balance available for deposit");
          console.log("\nOptions:");
          console.log("1. Get testnet ETH from a faucet");
          console.log("2. Set USE_ETH=false to supply WETH instead");
          process.exit(1);
        }
      }

      console.log(`  Final deposit amount: ${ethers.formatEther(SUPPLY_AMOUNT)}`);

      const wethGateway = new ethers.Contract(
        AAVE_WETHGATEWAY,
        ["function depositETH(address onBehalfOf, address pool, uint16 referralCode) payable"],
        wallet
      );

      supplyTx = await wethGateway.depositETH(wallet.address, AAVE_POOL_ADDRESS, 0, { value: SUPPLY_AMOUNT });
      console.log(`  Deposit transaction: ${supplyTx.hash}`);
      console.log("  Waiting for confirmation...");

    } else {
      // ERC20 token supply via Pool
      console.log("\nStep 1: Approving Pool to spend asset...");

      const isWETH = ASSET.toLowerCase() === WETH_ADDRESS.toLowerCase();

      let balance;
      if (isWETH) {
        // For WETH, use ETH balance directly
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

      if (balance < BigInt(SUPPLY_AMOUNT)) {
        console.log(`  ⚠️  Insufficient balance for full supply (need ${ethers.formatUnits(SUPPLY_AMOUNT, ASSET_DECIMALS)})`);
        console.log(`  🔧 Adjusting supply amount to available balance: ${formattedBalance}`);
        SUPPLY_AMOUNT = balance.toString();

        if (balance === 0n) {
          console.error(`❌ No ${ASSET_LABEL} balance available for supply`);
          console.log("\nOptions:");
          console.log("1. Get testnet tokens from a faucet");
          console.log("2. Set USE_ETH=true to deposit ETH instead");
          process.exit(1);
        }
      }

      console.log(`  Final supply amount: ${ethers.formatUnits(SUPPLY_AMOUNT, ASSET_DECIMALS)}`);

      // Approve Pool to spend the asset (skip for WETH)
      if (!isWETH) {
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

        const currentAllowance = await tokenContract.allowance(wallet.address, AAVE_POOL_ADDRESS);
        console.log(`  Current allowance: ${ethers.formatUnits(currentAllowance, ASSET_DECIMALS)}`);

        if (currentAllowance >= BigInt(SUPPLY_AMOUNT)) {
          console.log("  ✅ Sufficient allowance already exists, skipping approval");
        } else {
          const tokenWithWallet = tokenContract.connect(wallet);
          const approveTx = await tokenWithWallet.approve(AAVE_POOL_ADDRESS, SUPPLY_AMOUNT);
          console.log(`  Approval transaction: ${approveTx.hash}`);
          await approveTx.wait();
          console.log("  ✅ Approval confirmed");
        }
      } else {
        console.log("  ✅ Skipping approval (WETH wraps ETH directly)");
      }

      console.log("\nStep 2: Supplying to Aave Pool...");
      const aavePool = new ethers.Contract(
        AAVE_POOL_ADDRESS,
        ["function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)"],
        wallet
      );

      supplyTx = await aavePool.supply(ASSET, SUPPLY_AMOUNT, wallet.address, 0);
      console.log(`  Supply transaction: ${supplyTx.hash}`);
      console.log("  Waiting for confirmation...");
    }

    const receipt = await supplyTx.wait();
    console.log(`  ✅ Supply confirmed in block ${receipt.blockNumber}`);
    console.log(`  Gas used: ${receipt.gasUsed.toString()}`);

    console.log("\n✅ Supply transaction completed successfully!");
    console.log("\nNext steps:");
    console.log("1. Wait for the indexer to pick up this transaction (usually within a few minutes)");
    console.log("2. Run: npm run prove-queue");
    console.log('3. This will be classified as "Supply" for credit scoring');
  } catch (error) {
    console.error("❌ Error performing supply:", error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});