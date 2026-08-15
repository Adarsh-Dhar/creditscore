// Same address generateAndSubmitProof.js checks against in the main repo —
// keep these in sync if Aave redeploys on Sepolia.
// Confirm against https://github.com/bgd-labs/aave-address-book if unsure.
const AAVE_V3_SEPOLIA_POOL = "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951";

// Only the events the indexer cares about. Fragments taken from Aave V3's
// IPool — double check against the current aave-v3-core ABI if these error.
const POOL_EVENT_ABI = [
  "event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)",
  "event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)",
  "event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)",
  "event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)",
  "event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)",
];

const EVENT_NAMES = ["Supply", "Borrow", "Repay", "Withdraw", "LiquidationCall"];

const CHUNK_SIZE = Number(process.env.INDEXER_CHUNK_SIZE || 5000);

module.exports = { AAVE_V3_SEPOLIA_POOL, POOL_EVENT_ABI, EVENT_NAMES, CHUNK_SIZE };
