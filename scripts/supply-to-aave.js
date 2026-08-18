/**
 * supply-to-aave.js
 * 
 * Script to perform a supply transaction to Aave V3 on Sepolia
 * This will create a new event that can be indexed and proven for credit scoring
 * 
 * Usage: node scripts/supply-to-aave.js
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

  // Aave V3 Pool on Sepolia
  const AAVE_V3_SEPOLIA_POOL = "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951";

  // Aave WETH Gateway on Sepolia (for ETH deposits)
  const AAVE_WETH_GATEWAY = "0x387d311e47e80b498169e6fb51d3193167d89F7D";

  // Use ETH instead of USDC since your wallet has ETH
  const USE_ETH = true;
  const USDC_TOKEN = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";

  // Supply amount (will be set dynamically based on available balance)
  let SUPPLY_AMOUNT = "1000000000000000"; // Default 0.001 ETH

  console.log("Performing supply transaction to Aave V3 on Sepolia...");
  console.log(`  Aave Pool: ${AAVE_V3_SEPOLIA_POOL}`);
  console.log(`  Token: ${USE_ETH ? 'ETH' : 'USDC'}`);
  console.log(`  Target Amount: ${USE_ETH ? ethers.formatEther(SUPPLY_AMOUNT) + ' ETH' : ethers.formatUnits(SUPPLY_AMOUNT, 6) + ' USDC'} (will adjust based on balance)`);

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`  From wallet: ${wallet.address}`);
  if (TARGET_WALLET) {
    console.log(`  Credit will go to: ${TARGET_WALLET}`);
  }

  try {
    if (USE_ETH) {
      // Check ETH balance
      const ethBalance = await provider.getBalance(wallet.address);
      const formattedBalance = ethers.formatEther(ethBalance);

      console.log(`  ETH balance: ${formattedBalance}`);

      // Adjust supply amount if insufficient balance (keep 0.01 ETH for gas)
      const gasReserve = ethers.parseEther("0.01");
      const availableForSupply = ethBalance > gasReserve ? ethBalance - gasReserve : 0n;

      if (availableForSupply < BigInt(SUPPLY_AMOUNT)) {
        console.log(`  ⚠️  Insufficient ETH for full supply (need ${ethers.formatEther(SUPPLY_AMOUNT)} ETH)`);
        console.log(`  🔧 Adjusting supply amount to available balance: ${ethers.formatEther(availableForSupply)} ETH`);
        SUPPLY_AMOUNT = availableForSupply.toString();

        if (availableForSupply === 0n) {
          console.error("❌ No ETH balance available for supply (keeping reserve for gas)");
          process.exit(1);
        }
      }

      console.log(`  Final supply amount: ${ethers.formatEther(SUPPLY_AMOUNT)} ETH`);

      // Supply ETH to Aave using WETH Gateway
      console.log("\nSupplying ETH to Aave via WETH Gateway...");
      const wethGateway = new ethers.Contract(
        AAVE_WETH_GATEWAY,
        [
          "function depositETH(address pool, address onBehalfOf, uint16 referralCode) payable"
        ],
        wallet
      );

      const supplyTx = await wethGateway.depositETH(
        AAVE_V3_SEPOLIA_POOL,
        wallet.address,
        0, // referral code (0 for no referral)
        { value: SUPPLY_AMOUNT }
      );
      console.log(`  Supply transaction: ${supplyTx.hash}`);
      console.log("  Waiting for confirmation...");

      const receipt = await supplyTx.wait();
      console.log(`  ✅ Supply confirmed in block ${receipt.blockNumber}`);
      console.log(`  Gas used: ${receipt.gasUsed.toString()}`);

    } else {
      // Check USDC balance
      const usdcContract = new ethers.Contract(
        USDC_TOKEN,
        [
          "function balanceOf(address) view returns (uint256)",
          "function decimals() view returns (uint8)",
          "function approve(address spender, uint256 amount) returns (bool)",
          "function allowance(address owner, address spender) view returns (uint256)"
        ],
        provider
      );

      const balance = await usdcContract.balanceOf(wallet.address);
      const decimals = await usdcContract.decimals();
      const formattedBalance = ethers.formatUnits(balance, decimals);

      console.log(`  USDC balance: ${formattedBalance}`);

      // Adjust supply amount if insufficient balance
      if (balance < BigInt(SUPPLY_AMOUNT)) {
        console.log(`  ⚠️  Insufficient USDC for full supply (need ${ethers.formatUnits(SUPPLY_AMOUNT, 6)} USDC)`);
        console.log(`  🔧 Adjusting supply amount to available balance: ${formattedBalance} USDC`);
        SUPPLY_AMOUNT = balance.toString();

        if (balance === 0n) {
          console.error("❌ No USDC balance available");
          console.log("\nOptions:");
          console.log("1. Get USDC from a faucet (https://faucet.circle.com/)");
          console.log("2. Use a different token you have balance of");
          process.exit(1);
        }
      }

      console.log(`  Final supply amount: ${ethers.formatUnits(SUPPLY_AMOUNT, 6)} USDC`);

      // Approve Aave Pool to spend USDC
      console.log("\nStep 1: Approving Aave Pool to spend USDC...");

      // Check current allowance
      const currentAllowance = await usdcContract.allowance(wallet.address, AAVE_V3_SEPOLIA_POOL);
      console.log(`  Current allowance: ${ethers.formatUnits(currentAllowance, 6)} USDC`);

      if (currentAllowance >= BigInt(SUPPLY_AMOUNT)) {
        console.log("  ✅ Sufficient allowance already exists, skipping approval");
      } else {
        const usdcContractWithWallet = usdcContract.connect(wallet);
        const approveTx = await usdcContractWithWallet.approve(
          AAVE_V3_SEPOLIA_POOL,
          SUPPLY_AMOUNT
        );
        console.log(`  Approval transaction: ${approveTx.hash}`);
        await approveTx.wait();
        console.log("  ✅ Approval confirmed");
      }

      // Supply to Aave
      console.log("\nStep 2: Supplying USDC to Aave...");
      const aavePool = new ethers.Contract(
        AAVE_V3_SEPOLIA_POOL,
        [
          "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)"
        ],
        wallet
      );

      const supplyTx = await aavePool.supply(
        USDC_TOKEN,
        SUPPLY_AMOUNT,
        wallet.address,
        0 // referral code (0 for no referral)
      );
      console.log(`  Supply transaction: ${supplyTx.hash}`);
      console.log("  Waiting for confirmation...");

      const receipt = await supplyTx.wait();
      console.log(`  ✅ Supply confirmed in block ${receipt.blockNumber}`);
      console.log(`  Gas used: ${receipt.gasUsed.toString()}`);
    }

    console.log("\n✅ Supply transaction completed successfully!");
    console.log("\nNext steps:");
    console.log("1. Wait for the indexer to pick up this transaction (usually within a few minutes)");
    console.log("2. Run: npm run prove-queue");
    console.log("3. Your credit score should increase by 5 points (Supply × 5 weight)");

  } catch (error) {
    console.error("❌ Error performing supply:", error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});