# 10MinMine / 10MM — Mainnet

- **Package:** `0x06fe3c16c81994fc0c555f9288b2a9bc2265be45cc5a9a1107bdbc7f405b0f8a`
- **Coin type:** `0x06fe3c16c81994fc0c555f9288b2a9bc2265be45cc5a9a1107bdbc7f405b0f8a::tenmm::TENMM`
- **RewardPool:** `0x217e9585621795649cff80941d1c988d71ac488ed518211461b0496a050af4ec`
- **HolderRegistry:** `0x7ad733e66af7325b73ee80f64cd64b4113c6e89a444875112d511aea290530d2`
- **FeePot:** `0xf7edd1b51b54d8c58ff8728564428cd8c62ecc7233244e4c9f4e22997c800538`
- **Market:** `0x477a9f51937a7c07cdb84512c91d5c70e1951902fe08759f6b4bc4505f497c33`
- **CoinMetadata:** `0x5062ab4f35a69909bb327041c1b8901261bcda3346a9ef34f65f4d37c8a1522d`
- **GenesisLock:** `0xf96a9d255715c9393e2ecef7e348f8b4f7ac2231978d3d9c53dab886eb643450`
- **UpgradeCap:** discarded (`make_immutable`) — package is immutable
- **Icon:** https://raw.githubusercontent.com/2SECSUI/10MinMine/main/site/public/10mmLogo.png
- **Publish digest:** `CsFNJ9oaqHbibExrhKQtv5NgUoHqb67xdbQSZDWwrWyf`
- **First mine digest:** `DuB2ESmcgPJyxdTQZvrWouB75V3w3rddGoG3qfbNw4N9`
- **Suiscan package:** https://suiscan.xyz/mainnet/object/0x06fe3c16c81994fc0c555f9288b2a9bc2265be45cc5a9a1107bdbc7f405b0f8a
- **Suiscan coin:** https://suiscan.xyz/mainnet/coin/0x06fe3c16c81994fc0c555f9288b2a9bc2265be45cc5a9a1107bdbc7f405b0f8a::tenmm::TENMM

## Rules
- Bitcoin-style 21M hard cap, 8 decimals, ~10-minute blocks, 50 then halvings
- New 10MM only from `mine` (+ genesis lock)
- Buy/sell against seeded Market of already-mined coins (no mint-on-buy)
- Use `protocol_transfer` so holder registry / rewards follow
