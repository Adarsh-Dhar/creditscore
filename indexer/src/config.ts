export interface ProtocolConfig {
  id: string;
  poolAddress: string;
  abi: string[];
  wethGatewayAddress?: string;
  wethGatewayAbi?: string[];
  // Liquity-specific: TroveManager emits the operation events, but users
  // call BorrowerOperations (poolAddress above), and TroveManager's events
  // don't carry the trove owner's address at all (a troveId is a hash of
  // owner+ownerIndex). So for Liquity, `poolAddress` is what we validate
  // tx.to against and decode calldata from, while `eventEmitterAddress` is
  // only used off-chain to notice "something happened in this block range"
  // — the actual decode is calldata+sender based, not event-arg based.
  eventEmitterAddress?: string;
  // Liquity branch collateral token (e.g. WETH for the ETH branch) and the
  // BOLD stablecoin — used to populate the `asset` field for collateral vs.
  // debt operations respectively.
  collToken?: string;
  boldToken?: string;
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

// Liquity V2 doesn't have a usable "events" ABI for our purposes: the
// TroveOperation/TroveUpdated events are emitted by TroveManager (not by
// BorrowerOperations, which is what users actually call) and don't carry
// the borrower's address at all — troveId is a hash of owner+ownerIndex.
// So Liquity events are decoded from the transaction's own calldata
// (function selector) + sender, exactly like the on-chain contract does —
// see indexer/src/liquityDecoder.ts. No event ABI is declared here; the
// `abi` field for the liquity ProtocolConfig entry below is intentionally
// empty.

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
      {
        id: "liquity",
        // BorrowerOperations (ETH branch) — this is what users call, and
        // what the on-chain contract validates tx.to against.
        poolAddress: process.env.LIQUITY_SEPOLIA_BORROWER_OPERATIONS || "0x2377B5a07bdfA02812203BAB749E7bD43E4c596c",
        abi: [], // decoded from calldata, not events — see liquityDecoder.ts
        // TroveManager (ETH branch) — only used off-chain to notice trove
        // activity in a block range; never validated as a tx.to target.
        eventEmitterAddress: process.env.LIQUITY_SEPOLIA_TROVE_MANAGER || "0x70fA06222e169329F7a2F386Ed70ad69A61228a5",
        collToken: process.env.LIQUITY_SEPOLIA_COLL_TOKEN || "0x2442cA14d1217b4dD503e47DFdF79b774b56Ea89",
        boldToken: process.env.LIQUITY_SEPOLIA_BOLD_TOKEN || "0x620Ce1130f7c63457784CDfa31CFccBFB6be5029",
      },
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
  // Documentational only — Liquity has no ABI events to enumerate here
  // (see the comment above CHAINS). liquityDecoder.ts's selector map
  // already produces these generic names directly, so this identity map
  // isn't consulted on the Liquity code path, but it's kept for parity
  // with the other protocols and so nothing iterating EVENT_NAME_MAP's
  // keys breaks if it's ever called for "liquity".
  liquity: {
    "Supply": "Supply",
    "Borrow": "Borrow",
    "Repay": "Repay",
    "Withdraw": "Withdraw",
  },
};

export const CHUNK_SIZE: number = Number(process.env.INDEXER_CHUNK_SIZE || 5000);

// Flat fallback values used when AI scoring fails (demo/testnet optimized)
// These are positive to build up credit, avoiding negative rawScore issues
export const POINTS_BY_EVENT: Record<string, number> = {
  Supply: 20,      // Positive for building credit
  Borrow: 5,       // Small positive - borrows aren't inherently bad
  Repay: 25,       // High positive for good repayment behavior
  Withdraw: 5,     // Small positive for responsible unwinding
  LiquidationCall: -30,  // Only liquidations are strongly negative
};

// Backward compatibility exports
export const POOL_EVENT_ABI: string[] = AAVE_EVENT_ABI;
export const CHAIN_EVENT_ABIS: Record<string, string[]> = {
  sepolia: AAVE_EVENT_ABI,
  "cc3-testnet": AAVE_EVENT_ABI,
};
export const EVENT_NAMES: string[] = GENERIC_EVENT_NAMES;
