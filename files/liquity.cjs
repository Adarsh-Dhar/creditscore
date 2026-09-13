/**
 * liquity.js
 *
 * Script to perform Liquity V2 (BOLD) BorrowerOperations transactions on
 * the ETH branch, Sepolia. Unlike Morpho Blue, Liquity V2 *is* deployed on
 * Sepolia, so this is a real, working script rather than a "not available"
 * stub.
 *
 * Supports: open, add-coll, withdraw-coll, withdraw-bold, repay-bold, close
 *
 * IMPORTANT — trove IDs: Liquity doesn't identify troves by wallet address;
 * a troveId is keccak256(owner, ownerIndex). Every operation except `open`
 * needs an existing troveId. Set LIQUITY_TROVE_ID in .env once you've
 * opened one (the `open` command below prints it), or pass it as the last
 * CLI argument.
 *
 * Usage:
 *   npm run liquity open [collAmountWei] [boldAmountWei]
 *   npm run liquity add-coll [collAmountWei] [troveId]
 *   npm run liquity withdraw-coll [collAmountWei] [troveId]
 *   npm run liquity withdraw-bold [boldAmountWei] [troveId]
 *   npm run liquity repay-bold [boldAmountWei] [troveId]
 *   npm run liquity close [troveId]
 *
 * Environment variables:
 *   SEPOLIA_RPC
 *   PRIVATE_KEY
 *   LIQUITY_SEPOLIA_BORROWER_OPERATIONS  (has a default)
 *   LIQUITY_SEPOLIA_COLL_TOKEN           (has a default — ETH branch collateral)
 *   LIQUITY_TROVE_ID                     (required for every op except `open`)
 *
 * NOTE on `open`: openTrove's full parameter list is the most involved
 * function in BorrowerOperations. The ABI below is verified against the
 * official Liquity V2 (BOLD) repository at:
 * https://github.com/liquity/bold/blob/a34960222df5061fa7c0213df5d20626adf3ecc4/contracts/src/BorrowerOperations.sol
 */

require("dotenv").config();
const { ethers } = require("ethers");

const OPEN_TROVE_ABI =
  "function openTrove(address _owner, uint256 _ownerIndex, uint256 _collAmount, uint256 _boldAmount, uint256 _upperHint, uint256 _lowerHint, uint256 _annualInterestRate, uint256 _maxUpfrontFee, address _addManager, address _removeManager, address _receiver) external returns (uint256)";

const BORROWER_OPERATIONS_ABI = [
  OPEN_TROVE_ABI,
  "function addColl(uint256 _troveId, uint256 _collAmount) external",
  "function withdrawColl(uint256 _troveId, uint256 _collWithdrawal) external",
  "function withdrawBold(uint256 _troveId, uint256 _boldAmount, uint256 _maxUpfrontFee) external",
  "function repayBold(uint256 _troveId, uint256 _boldAmount) external",
  "function closeTrove(uint256 _troveId) external",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

async function main() {
  const {
    SEPOLIA_RPC,
    PRIVATE_KEY,
    LIQUITY_SEPOLIA_BORROWER_OPERATIONS,
    LIQUITY_SEPOLIA_COLL_TOKEN,
    LIQUITY_TROVE_ID,
  } = process.env;

  if (!SEPOLIA_RPC || !PRIVATE_KEY) {
    console.error("Missing required environment variables:");
    console.error("  SEPOLIA_RPC");
    console.error("  PRIVATE_KEY");
    process.exit(1);
  }

  const BORROWER_OPERATIONS =
    LIQUITY_SEPOLIA_BORROWER_OPERATIONS || "0x2377B5a07bdfA02812203BAB749E7bD43E4c596c";
  const COLL_TOKEN = LIQUITY_SEPOLIA_COLL_TOKEN || "0x2442cA14d1217b4dD503e47DFdF79b774b56Ea89";

  const operation = process.argv[2] || "open";
  const validOperations = ["open", "add-coll", "withdraw-coll", "withdraw-bold", "repay-bold", "close"];
  if (!validOperations.includes(operation)) {
    console.error(`Invalid operation: ${operation}`);
    console.error(`Valid operations: ${validOperations.join(", ")}`);
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const borrowerOps = new ethers.Contract(BORROWER_OPERATIONS, BORROWER_OPERATIONS_ABI, wallet);

  console.log(`Performing ${operation} transaction to Liquity V2 (ETH branch) on Sepolia...`);
  console.log(`  BorrowerOperations: ${BORROWER_OPERATIONS}`);
  console.log(`  From wallet: ${wallet.address}`);

  function resolveTroveId(argIndex) {
    const fromArg = process.argv[argIndex];
    const troveId = fromArg || LIQUITY_TROVE_ID;
    if (!troveId) {
      console.error(`❌ No trove ID provided. Pass it as an argument or set LIQUITY_TROVE_ID in .env.`);
      console.error(`   (Run "npm run liquity open" first if you don't have a trove yet.)`);
      process.exit(1);
    }
    return troveId;
  }

  try {
    let tx;

    switch (operation) {
      case "open": {
        // NOTE: Liquity V2 enforces a hard MIN_DEBT floor of 2000 BOLD per Trove
        // (entireDebt = boldAmount + upfront fee must clear it) — requesting less
        // reverts with the custom error DebtBelowMin() (selector 0xf1e41913).
        // 2200 leaves headroom above the floor for the upfront fee.
        const collAmount = process.argv[3] || "2000000000000000000"; // 2 collateral tokens, 18 dec
        const boldAmount = process.argv[4] || "2200000000000000000000"; // 2200 BOLD, 18 dec (MIN_DEBT is 2000)

        console.log(`\nStep 1: Getting WETHTester collateral...`);
        const collToken = new ethers.Contract(
          COLL_TOKEN,
          ["function deposit() payable", "function tap()", "function balanceOf(address) view returns (uint256)"],
          wallet
        );
        
        const balance = await collToken.balanceOf(wallet.address);
        console.log(`  WETHTester balance: ${ethers.formatEther(balance)}`);
        
        if (balance < BigInt(collAmount)) {
          console.log(`  Insufficient balance, depositing ETH to get WETHTester...`);
          const depositAmount = ethers.parseEther("0.05");
          const depositTx = await collToken.deposit({ value: depositAmount });
          console.log(`  Deposit tx: ${depositTx.hash}`);
          await depositTx.wait();
          console.log("  ✅ Deposit confirmed");
          
          const newBalance = await collToken.balanceOf(wallet.address);
          console.log(`  New WETHTester balance: ${ethers.formatEther(newBalance)}`);
        }

        console.log(`\nStep 2: Approving BorrowerOperations to spend WETHTester...`);
        const erc20Token = new ethers.Contract(COLL_TOKEN, ERC20_ABI, wallet);
        const currentAllowance = await erc20Token.allowance(wallet.address, BORROWER_OPERATIONS);
        // openTrove requires collAmount + gasCompensation (0.0375 WETHTester)
        const gasCompensation = ethers.parseUnits("0.0375", 18);
        const totalRequired = BigInt(collAmount) + gasCompensation;
        if (currentAllowance < totalRequired) {
          const approveTx = await erc20Token.approve(BORROWER_OPERATIONS, ethers.MaxUint256);
          console.log(`  Approval transaction: ${approveTx.hash}`);
          await approveTx.wait();
          console.log("  ✅ Approval confirmed");
        }

        console.log(`\nStep 3: Opening trove (coll=${ethers.formatEther(collAmount)} WETHTester, bold=${ethers.formatEther(boldAmount)} BOLD)...`);
        // ownerIndex 0 (first trove for this owner), no hint optimization,
        // 5% annual interest rate, no upfront-fee cap, no add/remove manager
        // delegation. IMPORTANT: BorrowerOperations' internal check
        // (_requireNonZeroManagerUnlessWiping in AddRemoveManagers.sol)
        // reverts with EmptyManager() (selector 0x22359217) if _removeManager
        // is the zero address but _receiver is NOT — they must both be zero
        // together, or both be set. Passing wallet.address as receiver while
        // leaving removeManager at ZeroAddress trips exactly that check.
        tx = await borrowerOps.openTrove(
          wallet.address,
          0,
          collAmount,
          boldAmount,
          0,
          0,
          ethers.parseUnits("0.05", 18), // 5% annual interest rate
          ethers.MaxUint256, // no cap on upfront fee
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          ethers.ZeroAddress // must match removeManager (zero/zero) — see note above
        );
        break;
      }

      case "add-coll": {
        const troveId = resolveTroveId(4);
        let collAmount = BigInt(process.argv[3] || "500000000000000000"); // 0.5 WETHTester

        // Top up WETHTester the same way `open` does, since gas
        // compensation on openTrove can leave the wallet short.
        const collToken = new ethers.Contract(
          COLL_TOKEN,
          ["function deposit() payable", "function balanceOf(address) view returns (uint256)"],
          wallet
        );
        const balance = await collToken.balanceOf(wallet.address);
        console.log(`  WETHTester balance: ${ethers.formatEther(balance)}`);
        if (balance < collAmount) {
          console.log(`  Insufficient balance, wrapping ETH into WETHTester...`);
          const shortfall = collAmount - balance;
          // wrap a bit extra so this doesn't need to run twice
          const depositTx = await collToken.deposit({ value: shortfall + ethers.parseEther("0.01") });
          console.log(`  Deposit tx: ${depositTx.hash}`);
          await depositTx.wait();
          console.log("  ✅ Deposit confirmed");
        }

        console.log(`\nApproving and adding ${ethers.formatEther(collAmount)} WETHTester collateral to trove ${troveId}...`);
        const token = new ethers.Contract(COLL_TOKEN, ERC20_ABI, wallet);
        const currentAllowance = await token.allowance(wallet.address, BORROWER_OPERATIONS);
        if (currentAllowance < collAmount) {
          const approveTx = await token.approve(BORROWER_OPERATIONS, ethers.MaxUint256);
          console.log(`  Approval transaction: ${approveTx.hash}`);
          await approveTx.wait();
        }
        tx = await borrowerOps.addColl(troveId, collAmount);
        break;
      }

      case "withdraw-coll": {
        const troveId = resolveTroveId(4);
        let collAmount = BigInt(process.argv[3] || "200000000000000000"); // 0.2 WETHTester

        // A trove near MIN_DEBT has little headroom above MCR, so a fixed
        // withdrawal amount can legitimately revert. Retry with
        // progressively smaller amounts rather than failing outright.
        const attempts = [collAmount, collAmount / 2n, collAmount / 4n, collAmount / 10n];
        let lastError;
        for (const amount of attempts) {
          if (amount === 0n) break;
          try {
            console.log(`\nWithdrawing ${ethers.formatEther(amount)} WETHTester collateral from trove ${troveId}...`);
            tx = await borrowerOps.withdrawColl(troveId, amount);
            lastError = null;
            break;
          } catch (err) {
            console.log(`  ⚠️  Reverted (likely below MCR) at ${ethers.formatEther(amount)}, trying a smaller amount...`);
            lastError = err;
          }
        }
        if (lastError) {
          console.error("❌ Trove doesn't have enough headroom above its minimum collateral ratio.");
          console.error("   Run `npm run liquity add-coll` first, or repay some BOLD, then retry.");
          throw lastError;
        }
        break;
      }

      case "withdraw-bold": {
        const troveId = resolveTroveId(4);
        const boldAmount = process.argv[3] || "100000000000000000000"; // 100 BOLD
        console.log(`\nBorrowing ${boldAmount} more BOLD against trove ${troveId}...`);
        tx = await borrowerOps.withdrawBold(troveId, boldAmount, ethers.MaxUint256);
        break;
      }

      case "repay-bold": {
        const troveId = resolveTroveId(4);
        const boldAmount = process.argv[3] || "50000000000000000000"; // 50 BOLD
        console.log(`\nRepaying ${boldAmount} BOLD on trove ${troveId}...`);
        tx = await borrowerOps.repayBold(troveId, boldAmount);
        break;
      }

      case "close": {
        const troveId = resolveTroveId(3);
        console.log(`\nClosing trove ${troveId} (repays all debt, returns all collateral)...`);
        tx = await borrowerOps.closeTrove(troveId);
        break;
      }
    }

    console.log(`  Transaction: ${tx.hash}`);
    console.log("  Waiting for confirmation...");
    const receipt = await tx.wait();

    if (receipt.status === 0) {
      console.error(`❌ Transaction failed on-chain (block ${receipt.blockNumber})`);
      process.exit(1);
    }

    console.log(`  ✅ ${operation} confirmed in block ${receipt.blockNumber}`);
    console.log(`  Gas used: ${receipt.gasUsed.toString()}`);

    if (operation === "open") {
      // openTrove returns the new troveId, but ethers v6 needs the return
      // data decoded from the tx's static call / logs rather than the
      // receipt directly for a non-view function — simplest robust path is
      // to just tell the user how to find it.
      console.log(
        `\n💡 openTrove doesn't return the troveId in the receipt directly — check the TroveManager's` +
          ` TroveUpdated/TroveOperation event in this tx on Etherscan, or compute it as` +
          ` keccak256(abi.encode(owner, ownerIndex)) with ownerIndex=0.`
      );
      console.log(`   Once you have it, set LIQUITY_TROVE_ID in .env for the other operations.`);
    }

    console.log("\nNext steps:");
    console.log("1. Wait for the indexer to pick up this transaction (usually within a few minutes)");
    console.log("2. Run: npm run prove-queue");
  } catch (error) {
    console.error(`❌ Error performing ${operation}:`, error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
