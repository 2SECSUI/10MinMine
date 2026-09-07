# 10MinMine laptop scripts (Windows)

## First time
```powershell
cd $HOME\OneDrive\Desktop\10MinMine-laptop
.\setup_repo.ps1          # clones ../10MinMine for GitHub Pages pushes
sui client switch --env mainnet
```

## Run
```powershell
.\mine_if_owed.ps1        # one try if a block is owed
.\mine_loop_10m.ps1       # every 10m
```

Each successful mine:
1. Calls `tenmm::mine` on mainnet
2. Appends a line to `mine_log.txt`
3. Updates `site/data` + `site/public` mint JSON in the cloned repo
4. `git commit` + `git push` so https://2secsui.github.io/10MinMine/site/ refreshes

X batch images every 20 blocks still run on the bot (optional).

Bot posts a 12-hour block/reward list to @TenMinMine (not from this laptop script).

## Auto-register holders (official Send)
`register_untracked.ps1` runs before each mine:
1. Reads `register_watchlist.txt` (and GraphQL coin owners when available)
2. Skips wallets already in the on-chain holder registry / pools
3. Official `protocol_transfer` from ops tracked principal (default `REGISTER_10MM=1`, or amount after comma in the watchlist)

Cetus/Turbos buys alone do **not** register. Only this path / site Send / mine does.

Mint log then shows each registered holder’s share (you get less; they get some).

## Post-mine allocation (until first halving @ 210000)
After each mine, `allocate_mine_rewards.ps1` splits the **ops registry share**:
- **98%** -> Aftermath farm rewards (TENMM only)
- **2%** -> new out-of-range Cetus positions via `cetus_oor_add.mjs` (TENMM only)

The OOR path never matches SUI into an in-range LP. SUI is checked and reserved only for transaction gas (default reserve: 0.75 SUI); `suiLiquidityInputRaw` is always zero. All live Cetus OOR adds are batched into one PTB, and the claim/OOR wrappers never invoke `cetus_lp_add` or match an in-range position. Turbos remains unused. Any rounding residue is added to Aftermath.

For a manual claim, use `claim_then_oor.ps1` (or the compatibility name `claim_aftermath_to_lps.ps1`). The Task Scheduler entrypoint is `ops/run_aftermath_claim_lp.ps1`; it points to the same claim-then-OOR workflow.

## Current Aftermath farm

Use `laptop/FARM.md` as the canonical mainnet record. The live TENMM farm is `0x4312dd6776ffbc77801d0b85821f9d129eb6e0af0648ab7beea591f708f74ff7`; its AuthorityCap is `0x6b61c57c69dd56a419be9b384e1422a2056628dba993e576a2a42776335f92ed`. The initial reward is 11 TENMM at 4185 mist per 10-minute period with a five-year emission window; run `allocate_mine_rewards.ps1 -Execute` after mines to top up continuously.

## Aftermath emission and top-up (run on the laptop only)

Do not run the signing commands from the repository box. Pull the scripts into the separate runtime directory and install dependencies there:
Windows paths: C:\Users\carlo\OneDrive\Desktop\10MinMine and C:\Users\carlo\OneDrive\Desktop\10MinMine-laptop.
Run dependency installation in both the Desktop repository and the separate laptop runtime directory before starting the mine loop.
The mine loop invokes the allocation script after each successful mine; allocations are planned for the 10-minute cycle.
The one-time emission migration is `set_aftermath_emission.mjs` and targets 4,570,000,000 mist (about 45.7 TENMM per 10-minute period); the one-time runway top-up is 274 TENMM via `aftermath_topup.mjs`.
## Cetus LP deployment

Refresh the laptop runtime in one PowerShell line, then restart the loop:
Refresh: pull, install dependencies, copy the three scripts, then restart the loop.
