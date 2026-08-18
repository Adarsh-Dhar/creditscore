/**
 * transfer-usdc.js
 * 
 * Script to transfer USDC from TARGET_WALLET to the wallet with the private key
 * Usage: node scripts/transfer-usdc.js
 */

require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
  const { SEPOLIA_RPC, PRIVATE_KEY, TARGET_WALLET } = process.env;

  if (!SEPOLIA_RPC || !PRIVATE_KEY || !TARGET_WALLET) {
    console.error("Missing required environment variables:");
    console.error("  SEPOLIA_RPC");
    console.error("  PRIVATE_KEY");
    console.error("  TARGET_WALLET");
    process.exit(1);
  }

  const USDC_TOKEN = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238";
  const TRANSFER_AMOUNT = "10000000"; // 10 USDC

  console.log("Transferring USDC from TARGET_WALLET to private key wallet...");
  console.log(`  From: ${TARGET_WALLET}`);
  console.log(`  To: ${ethers.Wallet.createRandom().address}`); // We'll replace this

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`  To: ${wallet.address}`);
  console.log(`  Amount: ${ethers.formatUnits(TRANSFER_AMOUNT, 6)} USDC`);

  try {
    const usdcContract = new ethers.Contract(
      USDC_TOKEN,
      [
        "function balanceOf(address) view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function transfer(address to, uint256 amount) returns (bool)"
      ],
      wallet
    );

    // Check balances
    const fromBalance = await usdcContract.balanceOf(TARGET_WALLET);
    const toBalance = await usdcContract.balanceOf(wallet.address);

    console.log(`  From balance: ${ethers.formatUnits(fromBalance, 6)} USDC`);
    console.log(`  To balance: ${ethers.formatUnits(toBalance, 6)} USDC`);

    if (fromBalance < BigInt(TRANSFER_AMOUNT)) {
      console.error("❌ Insufficient USDC in TARGET_WALLET");
      process.exit(1);
    }

    // Transfer
    console.log("\nTransferring USDC...");
    const transferTx = await usdcContract.transfer(wallet.address, TRANSFER_AMOUNT);
    console.log(`  Transfer transaction: ${transferTx.hash}`);
    await transferTx.wait();
    console.log("  ✅ Transfer confirmed");

    // Check new balance
    const newBalance = await usdcContract.balanceOf(wallet.address);
    console.log(`  New balance: ${ethers.formatUnits(newBalance, 6)} USDC`);

    console.log("\n✅ Transfer completed successfully!");
    console.log("Now you can run: npm run supply-to-aave");

  } catch (error) {
    console.error("❌ Error transferring USDC:", error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
