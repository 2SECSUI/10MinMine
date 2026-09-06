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
.\mine_loop_12m.ps1       # every 12m
```

Each successful mine:
1. Calls `tenmm::mine` on mainnet
2. Appends a line to `mine_log.txt`
3. Updates `site/data` + `site/public` mint JSON in the cloned repo
4. `git commit` + `git push` so https://2secsui.github.io/10MinMine/site/ refreshes

X batch images every 20 blocks still run on the bot (optional).
