#!/usr/bin/env bash
# One-shot 10MM mainnet mine call (Sui CLI).
# Prereqs: sui CLI installed, active env = mainnet, gas in the signing wallet.
set -euo pipefail

PACKAGE_ID="${PACKAGE_ID:-0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98}"
REWARD_POOL_ID="${REWARD_POOL_ID:-0x32423737a8e607111bc5ecb2ac49d226cc948abe4d690b55c20d63b09ee6e619}"
HOLDER_REGISTRY_ID="${HOLDER_REGISTRY_ID:-0x5c637f112680491744d2513484b78ca8c64c334dc9d4a3a6233c8f92dbd970e9}"
FEE_POT_ID="${FEE_POT_ID:-0xf74d1c532f9a676fcacdf92e4d70ea2d850fa5adc51e625224eda09e7a795213}"
CLOCK_ID="${CLOCK_ID:-0x6}"
GAS_BUDGET="${GAS_BUDGET:-10000000}"
OPS_ADDR="${OPS_ADDR:-0x58189b677894e0fe7ad38e0e516408a3500da57d86fc0436373bc1d9c6334d0a}"

if ! command -v sui >/dev/null 2>&1; then
  echo "error: sui CLI not found in PATH" >&2
  exit 1
fi

env_name="$(sui client active-env 2>/dev/null || true)"
addr="$(sui client active-address 2>/dev/null || true)"
echo "env=$env_name address=$addr"
if [[ "$env_name" != *mainnet* ]]; then
  echo "error: switch to mainnet first:  sui client switch --env mainnet" >&2
  exit 1
fi
if [[ "$addr" != "$OPS_ADDR" ]]; then
  echo "warn: active address is not the 10MM ops wallet ($OPS_ADDR)" >&2
  echo "      sui client switch --address $OPS_ADDR" >&2
fi

echo "calling tenmm::mine …"
sui client call \
  --package "$PACKAGE_ID" \
  --module tenmm \
  --function mine \
  --args "$REWARD_POOL_ID" "$HOLDER_REGISTRY_ID" "$FEE_POT_ID" "$CLOCK_ID" \
  --gas-budget "$GAS_BUDGET"
