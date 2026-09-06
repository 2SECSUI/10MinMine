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
