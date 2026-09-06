# 10MinMine / 10MM — Mainnet (v2)

Package design version: **v2.0.0** (mine pays holders on call; overflow-safe quotes).

- **Package:** `0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98`
- **Coin type:** `0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98::tenmm::TENMM`
- **RewardPool:** `0x32423737a8e607111bc5ecb2ac49d226cc948abe4d690b55c20d63b09ee6e619`
- **HolderRegistry:** `0x5c637f112680491744d2513484b78ca8c64c334dc9d4a3a6233c8f92dbd970e9`
- **FeePot:** `0xf74d1c532f9a676fcacdf92e4d70ea2d850fa5adc51e625224eda09e7a795213`
- **Market:** `0x946f3fd959e8232cf50684f3f54750ba85b591581976bb6321746222de2b36d9`
- **CoinMetadata:** `0xf75e87d9c3c2f662db6e436d11d400c6161480840b06d954005510344efd6ef5`
- **GenesisLock:** `0xdab05f52179b8f13488fe0adc9ac83f12873a9ca6292ed51fa178eeb6724d7c6`
- **UpgradeCap:** discarded (`make_immutable`) — digest `Auwxc53FyrB4rwFGMakiZ44eT1Vzs6ccsuDLxvG1VLCa`
- **Icon:** https://raw.githubusercontent.com/2SECSUI/10MinMine/main/site/public/10mmLogo.png
- **Publish digest:** `4ipA6D8q2BZHaUzoM4z1Mhx7ZiDizszjQyCguuFLAA8M`
- **First mine:** height 1, 50 10MM to ops — digest `E9tjqRESZbMddEDAoPYBAUg1iYyqoigQcK8J1ybieKG5`
- **Suiscan package:** https://suiscan.xyz/mainnet/object/0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98
- **Suiscan coin:** https://suiscan.xyz/mainnet/coin/0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98::tenmm::TENMM

## Legacy
Old immutable package `0x06fe3c16…0f8a` is abandoned (reward claim overflow). Do not use those IDs.

## Rules
- Bitcoin-style 21M hard cap, 8 decimals, ~10-minute blocks, 50 then halvings
- New 10MM only from `mine` (+ genesis lock)
- On each `mine`, block rewards are paid to registered holders immediately
- Buy/sell against seeded Market of already-mined coins (no mint-on-buy)
- Use `protocol_transfer` so holder registry / rewards follow

## Cetus LP (v2)
- **Pool:** `0xdee1982f5a75e5dace09b2f4dac1ed473cbbbd0ca34ad06a9876abffac7e2bb2`
- **Position:** `0x64477aaf7c88421b161315957ec71484174840d075742c979e85dd5fb05d43be` (ops wallet)
- **Pair:** 10MM / SUI
- **Position URL:** https://app.cetus.zone/position-detail/0x64477aaf7c88421b161315957ec71484174840d075742c979e85dd5fb05d43be
- **Create/add tx:** `F5EfspfCdDRGKyo46rPXmfAMipaBUp7KyQYsTUBtoiyt`
