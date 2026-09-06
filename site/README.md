# 10MinMine web app

Static GitHub Pages-compatible UI for **claim / buy / sell / Send** plus read-only 10mmscan pages.

## Security
- Wallet Standard connect only — private keys/seeds never touch the page
- Every action requires a wallet approval popup
- Network locked to `config.js` (`testnet` / `mainnet`)
- Move calls whitelisted to `claim`, `buy`, `sell`, and `transfer` (mapped to `protocol_transfer`)
- Object/package IDs must be `0x…` hex before actions enable
- CSP meta restricts scripts/connections where supported

## Config
Edit `config.js` after publish. Never put private keys in this repo. Empty IDs keep live actions disabled.

## Composability
TENMM is a standard Sui Coin with no denylist. DEXes and lending protocols can integrate when listed in `config.js`; site links are off-chain only.

## Local preview
From the `site/` directory, run `python3 -m http.server 8000`, then open `http://localhost:8000/`.
