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
After each mine, `allocate_mine_rewards.ps1` splits **ops registry share**:
- **98%** → Aftermath farm rewards `0x4312dd6776ffbc77801d0b85821f9d129eb6e0af0648ab7beea591f708f74ff7`
- **1%** → Cetus main pool `0xdee1982f5a75e5dace09b2f4dac1ed473cbbbd0ca34ad06a9876abffac7e2bb2` (10MM with matching SUI, in-range)
- **1%** → Cetus position `0x885c09217753a405d987d0604ba4c78f4c34510576a478f803bf4ace91a10546` (10MM-only while out of range, no SUI)
Turbos remains unused. Any rounding residue is added to Aftermath.
Other registered wallets keep their on-chain share (e.g. ~3.333) as developer costs.

## Current Aftermath farm

Use `laptop/FARM.md` as the canonical mainnet record. The live TENMM farm is `0x4312dd6776ffbc77801d0b85821f9d129eb6e0af0648ab7beea591f708f74ff7`; its AuthorityCap is `0x6b61c57c69dd56a419be9b384e1422a2056628dba993e576a2a42776335f92ed`. The initial reward is 11 TENMM at 4185 mist per 10-minute period with a five-year emission window; run `allocate_mine_rewards.ps1 -Execute` after mines to top up continuously.
