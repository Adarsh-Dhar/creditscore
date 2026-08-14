require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

module.exports = {
  solidity: "0.8.20",
  networks: {
    cc3Testnet: {
      // Confirm this RPC URL against the current docs before running —
      // testnet endpoints have changed before (v2 -> CC3 migration).
      url: process.env.CC3_TESTNET_RPC || "https://rpc.cc3-testnet.creditcoin.network",
      chainId: 102031, // Creditcoin Testnet chainId (creditCoin3Testnet) — verify before use
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
};
