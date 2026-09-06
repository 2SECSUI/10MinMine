Package design version: **v2.0.0** (direct mine payouts; fresh publish required).

# 10MinMine (10MM)

10MinMine is a Bitcoin-style mining coin for Sui. This repository contains package design **v2.0.0**. The prior mainnet package is abandoned and is not the v2 deployment; this design needs a fresh publish.

It does not replace or modify the archived `TenSecondBurn-Time-based-deflation` project. No v2 mainnet/testnet publish has been performed.

## Locked rulebook

| Rule | Value |
|---|---:|
| Name / metadata symbol | 10MinMine / `10MM` |
| Move type | `TENMM` |
| Decimals | 8 (`100,000,000` base units per token) |
| Hard cap | 21,000,000 10MM = `2,100,000,000,000,000` base units |
| Genesis | 50 10MM in a permanently frozen `GenesisLock` |
| Block time | 600 seconds |
| Initial subsidy | 50 10MM per block |
| Halving | Every 210,000 blocks |
| Catch-up | Maximum 1,008 blocks per `mine` call |
| Buy fee | 0.3% of SUI input to `FeePot` |
| Mine tip | 0.01 SUI (1,000,000 MIST) if `FeePot` has funds, otherwise 0 |

The TreasuryCap is retained inside the shared `RewardPool`; every issuance path
checks the hard cap. There is no burn vault, DAO, public mint, admin withdrawal,
or intended UpgradeCap path. A Sui package still has its normal package
upgrade capability at publish time: **discard the UpgradeCap on publish** and
treat the published package as immutable after publish.

## Mining and rewards

`mine(clock)` advances only complete elapsed ten-minute blocks, capped at 1,008.
When no registered circulating principal exists, early subsidy is paid to the
mine caller. Otherwise the emission is minted into `RewardPool` and each
registered holder's share is transferred to that holder in the same `mine` call.
A holder under one year earns every block; at one year the slot is every second
block, continuing to every 11th block at ten years and beyond. Rounding dust and
legacy `owed` balances remain available through `push_rewards` or `claim`.

The `HolderRegistry` is updated by `buy`, `sell`, and `protocol_transfer`.
Plain wallet Coin sends made outside `protocol_transfer` cannot be observed by
Move and therefore do not update the registry; use the helper for protocol
transfers.

## Routers and fees

`buy` uses a clearly temporary local 1 MIST = 1 base-unit rate: 0.3% is moved
to `FeePot`, the remainder becomes local `Market` liquidity, and output comes from
those seeded reserves; there is no mint-on-buy. `sell` settles any owed reward first and sells it
along with the principal in the same flow against local liquidity. These are
stub routers, not a production AMM. **TODO: replace the local rate/liquidity
with a Cetus pool/package integration after selecting the exact deployment and
slippage/oracle design.** The FeePot is intended to fund push-operation gas;
miners receive the on-chain tip when the pot is funded. `seed_liquidity` settles the sender and debits the sender's tracked principal by the seeded TENMM.

## Build and test locally

From this directory:

```bash
sui move build
sui move test
```

Tests cover the hard cap and 8-decimal policy, exact halving boundary,
1,008-block catch-up constant, overflow-safe quote math, direct mine payouts,
and tracked-principal debit during liquidity seeding. The package
uses the Sui framework `framework/testnet` revision in `Move.toml`.

The static site is under `site/` (v2 copy says rewards are paid by `mine`; the old mainnet IDs are intentionally disabled pending a fresh publish) and can be opened directly as
`site/index.html`. For a local static server, for example:

```bash
python3 -m http.server 8080 --directory site
```

Set IDs in `site/config.js` only after a local publish. It defaults to testnet
for wallet discovery and intentionally has no live IDs. The logo URL in Move
metadata points to the future GitHub raw `site/public/10mmLogo.png`; the local
file is a placeholder until the real logo is supplied.

## Useful calls

After a local publish, record `RewardPool`, `FeePot`, `Market`, `HolderRegistry`,
and the frozen `GenesisLock` IDs. The mine loop prints dry-run calls by default:

```bash
PACKAGE_ID=0x... REWARD_POOL_ID=0x... HOLDER_REGISTRY_ID=0x... \
FEE_POT_ID=0x... ./scripts/mine-loop.sh
```

Set `DRY_RUN=0` only when intentionally operating a configured local/testnet
deployment. This repository contains no publish command and should not be
published until explicitly approved.

## Remaining TODOs

- Wire real Cetus buy/sell swaps, price/oracle checks, slippage, and liquidity management.
- Replace the text/empty logo placeholder with the real `site/public/10mmLogo.png`.
- Add an indexer/balance view and amount/coin selection to the static Buy/Sell UI.
- Audit gas bounds for very long-lived reward claim intervals before production use.
