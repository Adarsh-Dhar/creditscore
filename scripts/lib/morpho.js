/**
 * supply-to-morpho.js
 *
 * Script to perform a supply transaction to Morpho Blue on Sepolia.
 * This will create a new event that can be indexed and proven for credit scoring.
 *
 * IMPORTANT — Morpho Blue is a permissionless singleton contract: there is no
 * single "the pool", instead there are many isolated markets, each identified
 * by a MarketParams struct { loanToken, collateralToken, oracle, irm, lltv }.
 * You must supply into an EXISTING market (one that's already been created on
 * this Morpho Blue deployment), otherwise the tx will revert.
 *
 * Fill these in via your .env (see .env.example additions below), using a
 * market you know exists on Sepolia — e.g. one you find on
 * https://app.morpho.org (switch network to Sepolia) or one you created
 * yourself via Morpho Blue's createMarket().
 *
 *   MORPHO_LOAN_TOKEN=
 *   MORPHO_COLLATERAL_TOKEN=
 *   MORPHO_ORACLE=
 *   MORPHO_IRM=
 *   MORPHO_LLTV=
 *
 * This script supplies the LOAN token as pure liquidity (the "Supply" event,
 * not SupplyCollateral). Set SUPPLY_COLLATERAL=true to instead call
 * supplyCollateral() with the COLLATERAL token, which the indexer also maps
 * to a "Supply" credit event.
 *
 * Usage: node scripts/supply-to-morpho.js
 */

require("dotenv").config();
const { ethers } = require("ethers");

async function main() {
  const {
    SEPOLIA_RPC,
    PRIVATE_KEY,
    TARGET_WALLET,
    MORPHO_BLUE_SEPOLIA_ADDRESS,
    MORPHO_LOAN_TOKEN,
    MORPHO_COLLATERAL_TOKEN,
    MORPHO_ORACLE,
    MORPHO_IRM,
    MORPHO_LLTV,
  } = process.env;

  if (!SEPOLIA_RPC || !PRIVATE_KEY) {
    console.error("Missing required environment variables:");
    console.error("  SEPOLIA_RPC");
    console.error("  PRIVATE_KEY");
    process.exit(1);
  }

  if (!MORPHO_LOAN_TOKEN || !MORPHO_COLLATERAL_TOKEN || !MORPHO_ORACLE || !MORPHO_IRM || !MORPHO_LLTV) {
    console.error("❌ Error: Morpho market parameters not configured in .env");
    console.error("Required environment variables:");
    console.error("  MORPHO_LOAN_TOKEN");
    console.error("  MORPHO_COLLATERAL_TOKEN");
    console.error("  MORPHO_ORACLE");
    console.error("  MORPHO_IRM");
    console.error("  MORPHO_LLTV");
    console.error("\nThese must describe an EXISTING market on Morpho Blue Sepolia.");
    console.error("Add them to your .env file to use the Morpho script.");
    process.exit(1);
  }

  // Morpho Blue singleton on Sepolia
  const MORPHO_ADDRESS = MORPHO_BLUE_SEPOLIA_ADDRESS || "0xd011EE229E7459ba1ddd22631eF7bF528d424A14";

  const marketParams = {
    loanToken: MORPHO_LOAN_TOKEN,
    collateralToken: MORPHO_COLLATERAL_TOKEN,
    oracle: MORPHO_ORACLE,
    irm: MORPHO_IRM,
    lltv: BigInt(MORPHO_LLTV),
  };

  // Toggle: supply loan-token liquidity vs. supply collateral
  const SUPPLY_COLLATERAL = (process.env.SUPPLY_COLLATERAL || "false").toLowerCase() === "true";
  const ASSET = SUPPLY_COLLATERAL ? marketParams.collateralToken : marketParams.loanToken;

  // Supply amount (will be adjusted based on available balance). Default: small nominal amount.
  let SUPPLY_AMOUNT = "1000000000000000"; // 0.001 (assuming 18 decimals; adjusted below once decimals are known)

  console.log("Performing supply transaction to Morpho Blue on Sepolia...");
  console.log(`  Morpho Blue: ${MORPHO_ADDRESS}`);
  console.log(`  Market: loan=${marketParams.loanToken} collateral=${marketParams.collateralToken}`);
  console.log(`  Mode: ${SUPPLY_COLLATERAL ? "supplyCollateral()" : "supply() [loan-token liquidity]"}`);

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`  From wallet: ${wallet.address}`);
  if (TARGET_WALLET) {
    console.log(`  Credit will go to: ${TARGET_WALLET}`);
  }

  console.log("\n✅ Morpho script is properly configured and ready to execute.");
  console.log("Note: Ensure you have sufficient token balances and valid market parameters before actual execution.");
  console.log("\nTo execute with collateral supply: SUPPLY_COLLATERAL=true npm run morpho");
  console.log("To execute with loan-token supply: SUPPLY_COLLATERAL=false npm run morpho");

  // Check if market parameters are fully configured
  if (!MORPHO_LOAN_TOKEN || !MORPHO_COLLATERAL_TOKEN || !MORPHO_ORACLE || !MORPHO_IRM || !MORPHO_LLTV) {
    console.error("\n❌ Error: Morpho market parameters not configured in .env");
    console.error("Required environment variables:");
    console.error("  MORPHO_LOAN_TOKEN");
    console.error("  MORPHO_COLLATERAL_TOKEN");
    console.error("  MORPHO_ORACLE");
    console.error("  MORPHO_IRM");
    console.error("  MORPHO_LLTV");
    console.error("\nThese must describe an EXISTING market on Morpho Blue Sepolia.");
    console.error("Add them to your .env file to use the Morpho script.");
    process.exit(1);
  }

  try {
    const WETH_ADDRESS = "0xfff9976782d46cc05630d34fae175e5c0be1995d";
    const isWETH = ASSET.toLowerCase() === WETH_ADDRESS.toLowerCase();

    let balance, decimals;

    if (isWETH) {
      // For WETH, use ETH balance directly
      balance = await provider.getBalance(wallet.address);
      decimals = 18;
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

      try {
        decimals = await tokenContract.decimals();
      } catch (e) {
        console.error("❌ Failed to fetch token decimals. The asset address may not be a valid ERC20.");
        console.error(`  Asset: ${ASSET}`);
        process.exit(1);
      }

      balance = await tokenContract.balanceOf(wallet.address);
    }

    SUPPLY_AMOUNT = ethers.parseUnits("0.001", decimals).toString();

    const formattedBalance = ethers.formatUnits(balance, decimals);
    console.log(`  Balance: ${formattedBalance}`);

    if (balance < BigInt(SUPPLY_AMOUNT)) {
      console.log(`  ⚠️  Insufficient balance for full supply (need ${ethers.formatUnits(SUPPLY_AMOUNT, decimals)})`);
      console.log(`  🔧 Adjusting supply amount to available balance: ${formattedBalance}`);
      SUPPLY_AMOUNT = balance.toString();

      if (balance === 0n) {
        console.error("❌ No balance available for supply");
        process.exit(1);
      }
    }

    console.log(`  Final supply amount: ${ethers.formatUnits(SUPPLY_AMOUNT, decimals)}`);

    // Approve Morpho Blue to spend the asset (skip for WETH)
    if (!isWETH) {
      console.log("\nStep 1: Approving Morpho Blue to spend asset...");
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

      const currentAllowance = await tokenContract.allowance(wallet.address, MORPHO_ADDRESS);
      console.log(`  Current allowance: ${ethers.formatUnits(currentAllowance, decimals)}`);

      if (currentAllowance >= BigInt(SUPPLY_AMOUNT)) {
        console.log("  ✅ Sufficient allowance already exists, skipping approval");
      } else {
        const tokenWithWallet = tokenContract.connect(wallet);
        const approveTx = await tokenWithWallet.approve(MORPHO_ADDRESS, SUPPLY_AMOUNT);
        console.log(`  Approval transaction: ${approveTx.hash}`);
        await approveTx.wait();
        console.log("  ✅ Approval confirmed");
      }
    } else {
      console.log("\nStep 1: Skipping approval (WETH wraps ETH directly)");
    }

    // Supply to Morpho Blue
    console.log(`\nStep 2: Calling ${SUPPLY_COLLATERAL ? "supplyCollateral" : "supply"}() on Morpho Blue...`);

    const morphoParamsTuple = [
      marketParams.loanToken,
      marketParams.collateralToken,
      marketParams.oracle,
      marketParams.irm,
      marketParams.lltv,
    ];

    let supplyTx;
    if (SUPPLY_COLLATERAL) {
      const morpho = new ethers.Contract(
        MORPHO_ADDRESS,
        [
          "function supplyCollateral((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams, uint256 assets, address onBehalfOf, bytes data)",
        ],
        wallet
      );
      supplyTx = await morpho.supplyCollateral(morphoParamsTuple, SUPPLY_AMOUNT, wallet.address, "0x");
    } else {
      const morpho = new ethers.Contract(
        MORPHO_ADDRESS,
        [
          "function supply((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalfOf, bytes data) returns (uint256, uint256)",
        ],
        wallet
      );
      supplyTx = await morpho.supply(morphoParamsTuple, SUPPLY_AMOUNT, 0, wallet.address, "0x");
    }

    console.log(`  Supply transaction: ${supplyTx.hash}`);
    console.log("  Waiting for confirmation...");

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
    if (error.message && error.message.includes("market not created")) {
      console.error("\nThis market doesn't exist on this Morpho Blue deployment yet.");
      console.error("Double-check your MORPHO_* env vars, or create the market first with createMarket().");
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});