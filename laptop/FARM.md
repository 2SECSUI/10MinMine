# Aftermath TENMM farm

Canonical farm for 10MinMine (mainnet):

- Farm/Vault: `0x4312dd6776ffbc77801d0b85821f9d129eb6e0af0648ab7beea591f708f74ff7`
- AuthorityCap: `0x6b61c57c69dd56a419be9b384e1422a2056628dba993e576a2a42776335f92ed`
- URL: https://aftermath.finance/farms/0x4312dd6776ffbc77801d0b85821f9d129eb6e0af0648ab7beea591f708f74ff7
- Stake/reward: `0xa03d915a9337be2463a5a391c2f9d470ad245eaeb96b6eac9a881618e494df98::tenmm::TENMM`
- Minimum stake: 1 TENMM (`100000000` mist)
- Locking: strict, 0 ms minimum/maximum, 1.0x multiplier
- Emission schedule: 600000 ms (10 minutes)
- Initial emission rate: 4185 mist (`0.00004185` TENMM per period)
- Emission start: `1788738090586` ms (2026-09-07 00:41:30.586 Europe/Dublin)
- Emission end: `1946444490586` ms (2031-09-07 00:41:30.586 Europe/Dublin)

The initial 11 TENMM reward was recovered from the ended farm and seeded here. The low initial rate deliberately gives a multi-year emission window; ongoing `allocate_mine_rewards.ps1 -Execute` top-ups extend the funded runway without recreating the old short-window bug. The owner cap is operational data, not a secret; never commit private keys or keystore files.

Transactions:

- Old-farm recovery (11 TENMM): `DA3dsuxuDLgswkHTnmhZLJC6991WyUFDyNfytVurHG1t`
- New farm creation: `9cvoxfhykeL3nUNx68VkCmnWdNZV9wmtrTBzExAntUWW`
- Reward initialization: `3jykeso1TmKQVSjCssLEdV6AzUPZ9XYepKLv5hsziTMX`
