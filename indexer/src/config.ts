export interface ProtocolConfig {
  id: string;
  poolAddress: string;
  abi: string[];
  wethGatewayAddress?: string;
  wethGatewayAbi?: string[];
}

export interface ChainConfig {
  name: string;
  rpcEnvVar: string;
  numericChainId: number;
  protocols: ProtocolConfig[];
}

// Aave V3 Pool events — taken from Aave V3's IPool ABI
export const AAVE_EVENT_ABI: string[] = [
  "event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)",
  "event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)",
  "event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)",
  "event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)",
  "event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)",
];

// Aave V3 WETHGateway events — taken from Aave's WETHGateway ABI
export const AAVE_WETHGATEWAY_EVENT_ABI: string[] = [
  "event DepositETH(address indexed reserve, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)",
  "event WithdrawETH(address indexed reserve, address indexed to, uint256 amount)",
];

// Compound Comet events — taken from Compound Comet ABI
// Note: Comet only has Supply/Withdraw/Absorb events. Borrow/Repay are tracked via asset type
export const COMPOUND_EVENT_ABI: string[] = [
  "event Supply(address indexed asset, address indexed from, uint256 amount)",
  "event Withdraw(address indexed asset, address indexed to, uint256 amount)",
  "event Absorb(address indexed absorber, address[] indexed accounts)",
];

// Morpho Blue events — taken from Morpho Blue ABI
export const MORPHO_EVENT_ABI: string[] = [
  "event SupplyCollateral(bytes32 indexed id, address indexed supplier, address indexed onBehalfOf, uint256 amount, uint256 shares)",
  "event WithdrawCollateral(bytes32 indexed id, address indexed owner, address indexed receiver, uint256 amount, uint256 shares)",
  "event Supply(bytes32 indexed id, address indexed supplier, address indexed onBehalfOf, uint256 amount, uint256 shares)",
  "event Withdraw(bytes32 indexed id, address indexed owner, address indexed receiver, uint256 amount, uint256 shares)",
  "event Borrow(bytes32 indexed id, address indexed borrower, address indexed receiver, uint256 amount, uint256 shares)",
  "event Repay(bytes32 indexed id, address indexed caller, address indexed onBehalfOf, uint256 amount, uint256 shares)",
  "event Liquidate(bytes32 indexed id, address indexed caller, address indexed borrower, address indexed receiver, uint256 amount, uint256 shares)",
];

// Chain configuration for multi-chain, multi-protocol support
// Each chain entry defines the RPC URL, chain ID, and nested protocol configurations
export const CHAINS: ChainConfig[] = [
  {
    name: "sepolia",
    rpcEnvVar: "SEPOLIA_RPC",
    numericChainId: 11155111, // Ethereum Sepolia chain ID
    protocols: [
      {
        id: "aave",
        poolAddress: process.env.AAVE_SEPOLIA_POOL || "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951",
        abi: AAVE_EVENT_ABI,
        wethGatewayAddress: process.env.AAVE_SEPOLIA_WETHGATEWAY || "0x387d311e47e80b498169e6fb51d3193167d89F7D",
        wethGatewayAbi: AAVE_WETHGATEWAY_EVENT_ABI,
      },
      {
        id: "compound",
        poolAddress: process.env.COMPOUND_SEPOLIA_COMET_USDC || "0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e",
        abi: COMPOUND_EVENT_ABI,
      },
      // Morpho Blue disabled on Sepolia - no markets exist on Sepolia chain
      // {
      //   id: "morpho",
      //   poolAddress: process.env.MORPHO_BLUE_SEPOLIA_ADDRESS || "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
      //   abi: MORPHO_EVENT_ABI,
      // },
    ],
  },
  {
    name: "cc3-testnet",
    rpcEnvVar: "CC3_TESTNET_SOURCE_RPC",
    numericChainId: 102031, // Creditcoin CC3 Testnet chain ID (tCTC)
    protocols: [
      {
        id: "aave",
        poolAddress: process.env.CC3_LENDING_POOL_ADDRESS || "0x0000000000000000000000000000000000000000", // Placeholder - requires actual lending protocol deployment
        abi: AAVE_EVENT_ABI,
      },
    ],
  },
  // Future chains can be added here:
  // {
  //   name: "base-sepolia",
  //   rpcEnvVar: "BASE_SEPOLIA_RPC",
  //   numericChainId: 84532,
  //   protocols: [],
  // },
];

// Generic event names used for EventType enum (protocol-agnostic)
export const GENERIC_EVENT_NAMES: string[] = ["Supply", "Borrow", "Repay", "Withdraw", "LiquidationCall"];

// Protocol-specific event name mapping to generic EventType
export const EVENT_NAME_MAP: Record<string, Record<string, string>> = {
  aave: {
    "Supply": "Supply",
    "Borrow": "Borrow",
    "Repay": "Repay",
    "Withdraw": "Withdraw",
    "LiquidationCall": "LiquidationCall",
    "DepositETH": "Supply",
    "WithdrawETH": "Withdraw",
  },
  compound: {
    "Supply": "Supply", // Will be classified as Supply or Repay based on asset type
    "Withdraw": "Withdraw", // Will be classified as Withdraw or Borrow based on asset type
    "Absorb": "LiquidationCall",
  },
  morpho: {
    "SupplyCollateral": "Supply",
    "Supply": "Supply",
    "WithdrawCollateral": "Withdraw",
    "Withdraw": "Withdraw",
    "Borrow": "Borrow",
    "Repay": "Repay",
    "Liquidate": "LiquidationCall",
  },
};

export const CHUNK_SIZE: number = Number(process.env.INDEXER_CHUNK_SIZE || 5000);

// Backward compatibility exports
export const POOL_EVENT_ABI: string[] = AAVE_EVENT_ABI;
export const CHAIN_EVENT_ABIS: Record<string, string[]> = {
  sepolia: AAVE_EVENT_ABI,
  "cc3-testnet": AAVE_EVENT_ABI,
};
export const EVENT_NAMES: string[] = GENERIC_EVENT_NAMES;
