# Cetus 10MM single-sided OOR routine

Script: `cetus_oor_add.mjs` (default build-only dry-run; `--plan-only` prints ranges without PTB building; `--execute` submits one batched PTB for all pools).

## Range rule

The script reads live Cetus pools from `../site/config.js`, reads the current `10MM` balance, and splits it equally across the eight live Cetus pools. It reads 10MM/USD from DexScreener (`CONFIG.dexscreenerUrl`), uses a lower target of spot + $0.002 (0.2 US cent), and an upper target of $1. Tick spacing is 60 for all eight pools. It converts quote-per-10MM into Cetus raw `coin_b / coin_a` price with each coin's decimals, then rounds to tick spacing. A TENMM-only position is below-range when TENMM is coin A and above-range when TENMM is coin B; in both cases the quoted 10MM/quote price band is above spot. Before each allocation the script reads all wallet-owned Cetus positions for the pool and compares the live pool tick with each position tickLower/tickUpper. If an existing OOR position is still outside the live tick, the 10MM allocation is added to that position. If the available position is in range, or no position exists, the allocation opens a new single-sided OOR position above spot; it never adds to an in-range position.

## Latest mainnet deployment

DexScreener 10MM/USD was 0.03411. Target lower USD was 0.03611; target upper was 1.00000. Latest wallet query after execution: 0.00000003 TENMM and 8.293645891 SUI; the 0.75 SUI gas reserve remains intact. Eight Cetus pools were funded. Turbos WAL and planned FlowX are not handled by this Cetus script.

| Pool | New position | Digest | Ticks | Quote band (rounded) |
|---|---|---|---:|---:|
| 10MM/SUI (additional OOR positions) | `0x3967c0a7257cf3d5e0486772706d56372b05dea71bdee88b7ed38c0ea929eefa` | `HMymwvREbSwqaeyc3iHkapmazAQ5bTaSrt7cdp23BrGY` | -8280..24960 | 0.043694..1.213235 SUI |
| 10MM/SUI (additional OOR positions) | `0x503c7d9eb60ef882c7994261276809ff92a02e1f33ce649ca2d75e6967510be0` | `DwDPLvukEutohVErok3nSqZ4V19cRtG4knErmq2Xpt8A` | -8280..24960 | 0.043694..1.213235 SUI |
| 10MM/SUI (additional OOR positions) | `0xbdcd08c1255a7258cb5279388e1ab86534a6858fb858f62b89676a5ea899501b` | `uf5TbTvPfQo5M17sbru46oJ29wuNcPxBHCvNKe4y9Qt` | -8280..24960 | 0.043694..1.213235 SUI |
| 10MM/SUI | `0xfaf3533321aae426ce283cf3fe6ccafc72a0d220271f94347a0d2050257bf68f` | `81fHNtv15PBatHrQ2wLjoyYaXAGKDzNvt4JcWfLGR4bS` | -8280..24960 | 0.043694..1.213235 SUI |
| 10MM/USDC | `0xbdadbac09d9d3a5febc63977058ec7f4e4a5231271f33bd3e714d3be9d2d973a` | `FLiyYjYF2DEkkznGMN81P2LxCqaaJNPhn8ZPCMbE7kh9` | 46080..79320 | 0.035921..0.997404 USDC |
| 10MM/DEEP | `0xb63556963004c5f68e6588fa121e2536106106ebd7c060ffa57a9b1e7178c22a` | `5u4Tn1hZtAe4LEancGkABWV8v4f6N8EWgd7jTJCs7pwn` | 4920..38100 | 2.215240..61.141741 DEEP |
| 10MM/WAL | `0x67653111690811119031dbcce5d9245a6b9205ca3427d1b9d1a71ba664576cff` | `DL6wQL1C9Qv3asaUHFPKJMMsPg54FTCJPT5XKLanYZfG` | 25680..58920 | 1.303804..36.202216 WAL |
| 10MM/NAVX | `0x48cf5f7a8d46771b1004e712e7325107c034a7cf59de92286fea50aa887202cc` | `FB9uKrsXTTaxBgso9HwkRTWbTEuFcLyLihxSd4LQ3G2U` | -68880..-35640 | 3.529784..98.010100 NAVX |
| 10MM/NS | `0xa5482cd71eb46966d24e38ca8694b651fb7471a752c33a9c2ba6f2dac02a79e8` | `He8ADSqVK5h4FtmG17eAMY3EjwCNP7Q7Ty3srRCKnBeP` | -36540..-3360 | 2.589210..71.463511 NS |
| 10MM/vSUI (actual CERT) | `0xa85e350de1b34c376aec0e0820f5d180ea10cd29e9bb5ee2cead0b3bff45e547` | `DGUyLyS8gmBJK1ywLQ1QxcVqYSSk8bbigSxYpd9hK8vQ` | -8880..24300 | 0.041150..1.135750 CERT |
| 10MM/suiUSDT | `0x543e8144331b12d1d54952906fc756309bb437bedb9796c504ca51f0d9fdd61c` | `GrVyPSXZAYXJkvBgMtBC6tHtoPaNHEmUZguCRYcU3HcD` | -79260..-46080 | 0.036137..0.997404 USDT |

## Routine wording

ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œEvery 10 minutes: refresh DexScreener and the wallet; if 10MM/USD has risen, run `node cetus_oor_add.mjs --execute` from the laptop runtime. The script must first keep the 0.75 SUI gas reserve, split only currently available TENMM equally across live Cetus pools, add to an existing still-OOR position when one exists, otherwise open a new quote-price range starting about $0.002 above current spot, and never add to an in-range position. All pool adds are batched into one PTB to minimize gas.ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â
