// Chain configuration for multi-chain support
// Each chain entry defines the RPC URL, pool address, and chain ID for that network
const CHAINS = [
  {
    name: "sepolia",
    rpcEnvVar: "SEPOLIA_RPC",
    poolAddress: "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951",
    numericChainId: 11155111, // Ethereum Sepolia chain ID
  },
  {
    name: "cc3-testnet",
    rpcEnvVar: "CC3_TESTNET_SOURCE_RPC",
    poolAddress: process.env.CC3_LENDING_POOL_ADDRESS || "0x0000000000000000000000000000000000000000", // Placeholder - requires actual lending protocol deployment
    numericChainId: 102031, // Creditcoin CC3 Testnet chain ID (tCTC)
  },
  // Future chains can be added here:
  // {
  //   name: "base-sepolia",
  //   rpcEnvVar: "BASE_SEPOLIA_RPC",
  //   poolAddress: "0x...",
  //   numericChainId: 84532,
  // },
];

// Only the events the indexer cares about. Fragments taken from Aave V3's
// IPool — double check against the current aave-v3-core ABI if these error.
const POOL_EVENT_ABI = [
  "event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)",
  "event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)",
  "event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)",
  "event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)",
  "event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)",
];

// Per-chain ABI support - add different ABIs here if protocols have different event signatures
// For now, all chains use the same Aave-compatible ABI
const CHAIN_EVENT_ABIS = {
  sepolia: POOL_EVENT_ABI,
  "cc3-testnet": POOL_EVENT_ABI, // Update if CC3 Testnet uses different protocol
};

const EVENT_NAMES = ["Supply", "Borrow", "Repay", "Withdraw", "LiquidationCall"];

const CHUNK_SIZE = Number(process.env.INDEXER_CHUNK_SIZE || 5000);

module.exports = { CHAINS, POOL_EVENT_ABI, CHAIN_EVENT_ABIS, EVENT_NAMES, CHUNK_SIZE };
