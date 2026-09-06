# 10MinMine — laptop mining scripts

Mine **10MM** on Sui mainnet from your machine with the Sui CLI.

## Prereqs

1. Install [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install)
2. Import / select the **10MM ops wallet** (needs gas SUI):

```bash
sui client switch --env mainnet
sui client switch --address 0x58189b677894e0fe7ad38e0e516408a3500da57d86fc0436373bc1d9c6334d0a
```

3. `python3` on PATH (only for `mine_if_owed.sh` / the loop)

## Scripts

| Script | What it does |
|--------|----------------|
| `mine_once.sh` | Always calls `tenmm::mine` once |
| `mine_if_owed.sh` | Mines only if ≥600s since last on-chain block |
| `mine_loop_12m.sh` | Repeats `mine_if_owed` every 12 minutes |

```bash
chmod +x mine_once.sh mine_if_owed.sh mine_loop_12m.sh

# one call
./mine_once.sh

# only if a block is owed
./mine_if_owed.sh

# background-friendly loop (12m)
./mine_loop_12m.sh
```

## On-chain IDs (mainnet v2)

- Package: `0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98`
- RewardPool: `0x32423737a8e607111bc5ecb2ac49d226cc948abe4d690b55c20d63b09ee6e619`
- HolderRegistry: `0x5c637f112680491744d2513484b78ca8c64c334dc9d4a3a6233c8f92dbd970e9`
- FeePot: `0xf74d1c532f9a676fcacdf92e4d70ea2d850fa5adc51e625224eda09e7a795213`

Override any via env vars (`PACKAGE_ID`, `GAS_BUDGET`, `INTERVAL`, …).

## Notes

- Protocol block time is still **~10 minutes** on-chain; the loop is **12 minutes** so you don’t spam empty calls.
- Site mint-log + X batch posts are separate (every 20 heights) — these scripts only mine.
- Anyone can call `mine`; rewards go to registered holders. The caller tip is **0.01 SUI** from the fee pot when funded.


## Windows (PowerShell)

```powershell
cd $HOME
git clone https://github.com/2SECSUI/10MinMine.git
cd 10MinMine\laptop

sui client switch --env mainnet
.\mine_if_owed.ps1
# or:
.\mine_loop_12m.ps1
```

If scripts are blocked: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
