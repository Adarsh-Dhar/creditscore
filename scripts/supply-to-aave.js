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
  const { SEPOLIA_RPC, PRIVATE_KEY } = process.env;

  if (!SEPOLIA_RPC || !PRIVATE_KEY) {
    console.error("Missing required environment variables:");
    console.error("  SEPOLIA_RPC");
    console.error("  PRIVATE_KEY");
    process.exit(1);
  }

  // Aave V3 Pool on Sepolia
  const AAVE_V3_SEPOLIA_POOL = "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951";
  
  // LINK token on Sepolia (same as your previous transaction)
  const LINK_TOKEN = "0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5";
  
  // Supply amount (will be set dynamically based on available balance)
  let SUPPLY_AMOUNT = "5000000000000000000"; // Default 5 LINK

  console.log("Performing supply transaction to Aave V3 on Sepolia...");
  console.log(`  Aave Pool: ${AAVE_V3_SEPOLIA_POOL}`);
  console.log(`  Token: LINK (${LINK_TOKEN})`);
  console.log(`  Target Amount: ${ethers.formatEther(SUPPLY_AMOUNT)} LINK (will adjust based on balance)`);

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`  From wallet: ${wallet.address}`);

  try {
    // Check LINK balance
    const linkContract = new ethers.Contract(
      LINK_TOKEN,
      [
        "function balanceOf(address) view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function approve(address spender, uint256 amount) returns (bool)",
        "function allowance(address owner, address spender) view returns (uint256)"
      ],
      provider
    );

    const balance = await linkContract.balanceOf(wallet.address);
    const decimals = await linkContract.decimals();
    const formattedBalance = ethers.formatUnits(balance, decimals);

    console.log(`  LINK balance: ${formattedBalance}`);

    // Adjust supply amount if insufficient balance
    if (balance < BigInt(SUPPLY_AMOUNT)) {
      console.log(`  ⚠️  Insufficient LINK for full supply (need ${ethers.formatEther(SUPPLY_AMOUNT)} LINK)`);
      console.log(`  🔧 Adjusting supply amount to available balance: ${formattedBalance} LINK`);
      SUPPLY_AMOUNT = balance.toString();
      
      if (balance === 0n) {
        console.error("❌ No LINK balance available");
        console.log("\nOptions:");
        console.log("1. Get LINK from a faucet (https://faucets.chain.link/sepolia)");
        console.log("2. Use a different token you have balance of");
        process.exit(1);
      }
    }
    
    console.log(`  Final supply amount: ${ethers.formatEther(SUPPLY_AMOUNT)} LINK`);

    // Approve Aave Pool to spend LINK
    console.log("\nStep 1: Approving Aave Pool to spend LINK...");
    
    // Check current allowance
    const currentAllowance = await linkContract.allowance(wallet.address, AAVE_V3_SEPOLIA_POOL);
    console.log(`  Current allowance: ${ethers.formatEther(currentAllowance)} LINK`);
    
    if (currentAllowance >= BigInt(SUPPLY_AMOUNT)) {
      console.log("  ✅ Sufficient allowance already exists, skipping approval");
    } else {
      const linkContractWithWallet = linkContract.connect(wallet);
      const approveTx = await linkContractWithWallet.approve(
        AAVE_V3_SEPOLIA_POOL,
        SUPPLY_AMOUNT
      );
      console.log(`  Approval transaction: ${approveTx.hash}`);
      await approveTx.wait();
      console.log("  ✅ Approval confirmed");
    }

    // Supply to Aave
    console.log("\nStep 2: Supplying LINK to Aave...");
    const aavePool = new ethers.Contract(
      AAVE_V3_SEPOLIA_POOL,
      [
        "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)"
      ],
      wallet
    );

    const supplyTx = await aavePool.supply(
      LINK_TOKEN,
      SUPPLY_AMOUNT,
      wallet.address,
      0 // referral code (0 for no referral)
    );
    console.log(`  Supply transaction: ${supplyTx.hash}`);
    console.log("  Waiting for confirmation...");
    
    const receipt = await supplyTx.wait();
    console.log(`  ✅ Supply confirmed in block ${receipt.blockNumber}`);
    console.log(`  Gas used: ${receipt.gasUsed.toString()}`);

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