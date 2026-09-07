/**
 * Shared EventType <-> Solidity enum index mapping.
 *
 * Must match the `EventType` enum order in contracts/CreditScoreMVP.sol
 * exactly, and the indexer's EVENT_NAMES order (indexer/src/config.js).
 * Kept in one place so the CLI prove script and the batch queue script
 * can't silently drift apart.
 */
const EVENT_TYPE_INDEX = {
  Supply: 0,
  Borrow: 1,
  Repay: 2,
  Withdraw: 3,
  LiquidationCall: 4,
};

const EVENT_TYPE_NAMES = Object.fromEntries(
  Object.entries(EVENT_TYPE_INDEX).map(([name, index]) => [index, name])
);

module.exports = { EVENT_TYPE_INDEX, EVENT_TYPE_NAMES };