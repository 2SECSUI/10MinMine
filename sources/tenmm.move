/// 10MinMine (10MM): a Bitcoin-style, fixed-cap mining token for Sui.
///
/// This package intentionally has no public mint, DAO, burn vault, or admin
/// withdrawal path. The TreasuryCap is retained in RewardPool so all issuance
/// is checked against MAX_SUPPLY. Discard the UpgradeCap when publishing.
module ten_min_mine::tenmm {
    use std::option;
    use sui::balance::{Self, Balance};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin, TreasuryCap};
    use sui::object::{Self, UID};
    use sui::table::{Self, Table};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::url;
    use sui::sui::SUI;
    use std::vector;

    const DECIMALS: u8 = 8;
    const UNIT: u64 = 100_000_000;
    const MAX_SUPPLY: u64 = 2_100_000_000_000_000;
    const GENESIS_AMOUNT: u64 = 50 * UNIT;
    const INITIAL_SUBSIDY: u64 = 50 * UNIT;
    const BLOCK_TIME_SECS: u64 = 600;
    const HALVING_INTERVAL: u64 = 210_000;
    const MAX_CATCH_UP_BLOCKS: u64 = 1008;
    const YEAR_SECS: u64 = 31_536_000;
    const PUSH_FEE_BPS: u64 = 30;
    const BPS: u64 = 10_000;

    const E_BAD_AMOUNT: u64 = 0;
    const E_CAP_EXCEEDED: u64 = 1;
    const E_NO_BLOCKS: u64 = 2;
    const E_NOT_HOLDER: u64 = 3;
    const E_INSUFFICIENT_LIQUIDITY: u64 = 5;
    const E_BAD_RECIPIENT: u64 = 6;

    /// The Move type is TENMM; the wallet-visible metadata symbol is 10MM.
    public struct TENMM has drop {}

    /// Permanently frozen genesis allocation. It is deliberately not a Coin,
    /// and no module function can recover its Balance.
    public struct GenesisLock has key {
        id: UID,
        balance: Balance<TENMM>,
    }

    /// Shared issuance and reward pool. The cap is retained here for the whole
    /// lifetime of the package, and total_minted includes the genesis lock.
    public struct RewardPool has key {
        id: UID,
        rewards: Balance<TENMM>,
        cap: TreasuryCap<TENMM>,
        total_minted: u64,
        block_height: u64,
        last_block_ts: u64,
    }

    /// Fee pot used for the flat mining tip and documented push-operation gas.
    public struct FeePot has key {
        id: UID,
        balance: Balance<SUI>,
    }

    /// Constant-product local router reserves. Both reserves are seeded with
    /// already-issued assets; swaps never mint or burn TENMM.
    public struct Market has key {
        id: UID,
        sui: Balance<SUI>,
        tenmm: Balance<TENMM>,
    }

    public struct Holder has store, copy, drop {
        principal: u64,
        owed: u64,
        joined_ts: u64,
        last_settled_block: u64,
    }

    /// HolderRegistry is maintained only by buy/sell/protocol_transfer. Plain
    /// wallet sends outside these helpers cannot be observed by this package.
    public struct HolderRegistry has key {
        id: UID,
        holders: Table<address, Holder>,
        addresses: vector<address>,
        total_principal: u64,
    }

    #[test_only]
    public fun initialize_for_testing(ctx: &mut TxContext) { init(TENMM {}, ctx) }

    fun init(witness: TENMM, ctx: &mut TxContext) {
        let publisher = tx_context::sender(ctx);
        let (mut cap, metadata) = coin::create_currency<TENMM>(
            witness,
            DECIMALS,
            b"10MM",
            b"10MinMine",
            b"Bitcoin-style ten-minute mining coin with a 21 million hard cap",
            option::some(url::new_unsafe_from_bytes(b"https://raw.githubusercontent.com/2SECSUI/10MinMine/main/site/public/10mmLogo.png")),
            ctx,
        );
        transfer::public_transfer(metadata, publisher);

        let genesis = coin::mint(&mut cap, GENESIS_AMOUNT, ctx);
        let genesis_lock = GenesisLock { id: object::new(ctx), balance: coin::into_balance(genesis) };
        transfer::freeze_object(genesis_lock);

        let pool = RewardPool {
            id: object::new(ctx),
            rewards: balance::zero<TENMM>(),
            cap,
            total_minted: GENESIS_AMOUNT,
            block_height: 0,
            last_block_ts: 0,
        };
        let fee_pot = FeePot { id: object::new(ctx), balance: balance::zero<SUI>() };
        let market = Market {
            id: object::new(ctx),
            sui: balance::zero<SUI>(),
            tenmm: balance::zero<TENMM>(),
        };
        let registry = HolderRegistry {
            id: object::new(ctx),
            holders: table::new(ctx),
            addresses: vector::empty<address>(),
            total_principal: 0,
        };
        transfer::share_object(pool);
        transfer::share_object(fee_pot);
        transfer::share_object(market);
        transfer::share_object(registry);
    }

    /// Advance at most 1008 ten-minute blocks. When no registry principal
    /// exists, early subsidy is paid to the caller and they are registered
    /// so protocol_transfer / claim tracking works from the first mine.
    public entry fun mine(
        pool: &mut RewardPool,
        registry: &mut HolderRegistry,
        fee_pot: &mut FeePot,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let now = clock::timestamp_ms(clock) / 1000;
        let bootstrap = pool.last_block_ts == 0;
        let elapsed = if (now > pool.last_block_ts) { now - pool.last_block_ts } else { 0 };
        let mut blocks = if (bootstrap) { 1 } else { elapsed / BLOCK_TIME_SECS };
        if (blocks > MAX_CATCH_UP_BLOCKS) { blocks = MAX_CATCH_UP_BLOCKS };
        assert!(blocks > 0, E_NO_BLOCKS);
        let old_height = pool.block_height;
        let new_height = old_height + blocks;
        let emission = emission_between(old_height, new_height);
        pool.block_height = new_height;
        pool.last_block_ts = if (bootstrap) { now } else { pool.last_block_ts + blocks * BLOCK_TIME_SECS };
        if (emission > 0) {
            assert!(pool.total_minted + emission <= MAX_SUPPLY, E_CAP_EXCEEDED);
            pool.total_minted = pool.total_minted + emission;
            if (registry.total_principal == 0) {
                let sender = tx_context::sender(ctx);
                settle_or_add(registry, pool, sender, now);
                {
                    let holder = table::borrow_mut(&mut registry.holders, sender);
                    holder.principal = holder.principal + emission;
                    holder.last_settled_block = new_height;
                };
                registry.total_principal = registry.total_principal + emission;
                let payout = coin::mint(&mut pool.cap, emission, ctx);
                transfer::public_transfer(payout, sender);
            } else {
                balance::join(&mut pool.rewards, coin::into_balance(coin::mint(&mut pool.cap, emission, ctx)));
                distribute_mined_rewards(registry, pool, old_height, new_height, now, ctx);
            }
        };

        let tip = if (balance::value(&fee_pot.balance) >= 1_000_000) { 1_000_000 } else { 0 };
        if (tip > 0) {
            let payout = coin::from_balance(balance::split(&mut fee_pot.balance, tip), ctx);
            transfer::public_transfer(payout, tx_context::sender(ctx));
        }
    }

    /// Push accrued balances to an explicit batch of registered addresses.
    /// A front end should choose small batches and use FeePot to fund the
    /// transactions; the on-chain mine tip is separately paid to miners.
    public entry fun push_rewards(
        pool: &mut RewardPool,
        registry: &mut HolderRegistry,
        recipients: vector<address>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let now = clock::timestamp_ms(clock) / 1000;
        let mut i = 0;
        let n = vector::length(&recipients);
        while (i < n) {
            let recipient = *vector::borrow(&recipients, i);
            if (table::contains(&registry.holders, recipient)) {
                settle(registry, pool, recipient, now);
                let owed = table::borrow(&registry.holders, recipient).owed;
                let amount = if (owed > balance::value(&pool.rewards)) { balance::value(&pool.rewards) } else { owed };
                if (amount > 0) {
                    { let holder = table::borrow_mut(&mut registry.holders, recipient); holder.owed = holder.owed - amount; };
                    let payout = coin::from_balance(balance::split(&mut pool.rewards, amount), ctx);
                    transfer::public_transfer(payout, recipient);
                }
            };
            i = i + 1;
        };
    }

    /// Claim the sender's accrued rewards when push operations lag.
    public entry fun claim(pool: &mut RewardPool, registry: &mut HolderRegistry, clock: &Clock, ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);
        assert!(table::contains(&registry.holders, sender), E_NOT_HOLDER);
        settle(registry, pool, sender, clock::timestamp_ms(clock) / 1000);
        let amount = {
            let holder = table::borrow_mut(&mut registry.holders, sender);
            let owed = holder.owed;
            holder.owed = 0;
            owed
        };
        if (amount > 0) {
            assert!(amount <= balance::value(&pool.rewards), E_INSUFFICIENT_LIQUIDITY);
            let payout = coin::from_balance(balance::split(&mut pool.rewards, amount), ctx);
            transfer::public_transfer(payout, sender);
        }
    }

    /// Seed the constant-product market with already-mined TENMM and SUI.
    public entry fun seed_liquidity(
        market: &mut Market,
        pool: &RewardPool,
        registry: &mut HolderRegistry,
        sui_coin: Coin<SUI>,
        tenmm_coin: Coin<TENMM>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(coin::value(&sui_coin) > 0, E_BAD_AMOUNT);
        let seeded = coin::value(&tenmm_coin);
        assert!(seeded > 0, E_BAD_AMOUNT);
        let sender = tx_context::sender(ctx);
        assert!(table::contains(&registry.holders, sender), E_NOT_HOLDER);
        settle(registry, pool, sender, clock::timestamp_ms(clock) / 1000);
        {
            let holder = table::borrow_mut(&mut registry.holders, sender);
            assert!(seeded <= holder.principal, E_BAD_AMOUNT);
            holder.principal = holder.principal - seeded;
        };
        registry.total_principal = registry.total_principal - seeded;
        balance::join(&mut market.sui, coin::into_balance(sui_coin));
        balance::join(&mut market.tenmm, coin::into_balance(tenmm_coin));
    }

    /// Buy TENMM with SUI against the seeded constant-product reserves.
    /// The 0.3% fee is sent to FeePot; only net SUI joins the market.
    public entry fun buy(
        pool: &mut RewardPool,
        market: &mut Market,
        fee_pot: &mut FeePot,
        registry: &mut HolderRegistry,
        mut payment: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let input = coin::value(&payment);
        assert!(input > 0, E_BAD_AMOUNT);
        let fee = input * PUSH_FEE_BPS / BPS;
        let fee_coin = coin::split(&mut payment, fee, ctx);
        balance::join(&mut fee_pot.balance, coin::into_balance(fee_coin));
        let net = input - fee;
        let sui_reserve = balance::value(&market.sui);
        let tenmm_reserve = balance::value(&market.tenmm);
        assert!(net > 0 && sui_reserve > 0 && tenmm_reserve > 0, E_INSUFFICIENT_LIQUIDITY);
        let output = tenmm_reserve * net / (sui_reserve + net);
        assert!(output > 0 && output <= tenmm_reserve, E_INSUFFICIENT_LIQUIDITY);
        balance::join(&mut market.sui, coin::into_balance(payment));
        let tokens = coin::from_balance(balance::split(&mut market.tenmm, output), ctx);
        let buyer = tx_context::sender(ctx);
        let now = clock::timestamp_ms(clock) / 1000;
        settle_or_add(registry, pool, buyer, now);
        {
            let holder = table::borrow_mut(&mut registry.holders, buyer);
            holder.principal = holder.principal + output;
        };
        registry.total_principal = registry.total_principal + output;
        transfer::public_transfer(tokens, buyer);
    }

    /// Sell TENMM against the seeded constant-product reserves. Any settled
    /// rewards owed to the seller are included in the sold TENMM amount.
    public entry fun sell(
        pool: &mut RewardPool,
        market: &mut Market,
        registry: &mut HolderRegistry,
        payment: Coin<TENMM>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let seller = tx_context::sender(ctx);
        assert!(table::contains(&registry.holders, seller), E_NOT_HOLDER);
        settle(registry, pool, seller, clock::timestamp_ms(clock) / 1000);
        let principal = coin::value(&payment);
        let owed = {
            let holder = table::borrow_mut(&mut registry.holders, seller);
            assert!(principal <= holder.principal, E_BAD_AMOUNT);
            holder.principal = holder.principal - principal;
            let amount = holder.owed;
            holder.owed = 0;
            amount
        };
        registry.total_principal = registry.total_principal - principal;
        let mut sold = coin::into_balance(payment);
        if (owed > 0) {
            assert!(owed <= balance::value(&pool.rewards), E_INSUFFICIENT_LIQUIDITY);
            balance::join(&mut sold, balance::split(&mut pool.rewards, owed));
        };
        let amount_in = balance::value(&sold);
        let sui_reserve = balance::value(&market.sui);
        let tenmm_reserve = balance::value(&market.tenmm);
        assert!(amount_in > 0 && sui_reserve > 0 && tenmm_reserve > 0, E_INSUFFICIENT_LIQUIDITY);
        let output = sui_reserve * amount_in / (tenmm_reserve + amount_in);
        assert!(output > 0 && output <= sui_reserve, E_INSUFFICIENT_LIQUIDITY);
        balance::join(&mut market.tenmm, sold);
        let sui = coin::from_balance(balance::split(&mut market.sui, output), ctx);
        transfer::public_transfer(sui, seller);
    }

    /// Transfer helper that settles both sides before changing tracked holdings.
    /// Ordinary Coin transfers bypass this registry and are intentionally not
    /// treated as protocol transfers.
    public entry fun protocol_transfer(
        pool: &mut RewardPool,
        registry: &mut HolderRegistry,
        payment: Coin<TENMM>,
        recipient: address,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(recipient != @0x0, E_BAD_RECIPIENT);
        let sender = tx_context::sender(ctx);
        assert!(table::contains(&registry.holders, sender), E_NOT_HOLDER);
        let amount = coin::value(&payment);
        let now = clock::timestamp_ms(clock) / 1000;
        settle_or_add(registry, pool, sender, now);
        settle_or_add(registry, pool, recipient, now);
        {
            let from = table::borrow_mut(&mut registry.holders, sender);
            assert!(amount <= from.principal, E_BAD_AMOUNT);
            from.principal = from.principal - amount;
        };
        {
            let to = table::borrow_mut(&mut registry.holders, recipient);
            to.principal = to.principal + amount;
        };
        transfer::public_transfer(payment, recipient);
    }

    fun settle_or_add(registry: &mut HolderRegistry, pool: &RewardPool, who: address, now: u64) {
        if (table::contains(&registry.holders, who)) {
            settle(registry, pool, who, now)
        } else {
            table::add(&mut registry.holders, who, Holder { principal: 0, owed: 0, joined_ts: now, last_settled_block: pool.block_height });
            vector::push_back(&mut registry.addresses, who);
        }
    }

    fun settle(registry: &mut HolderRegistry, pool: &RewardPool, who: address, now: u64) {
        let total = registry.total_principal;
        let height = pool.block_height;
        let holder = table::borrow_mut(&mut registry.holders, who);
        let reward = reward_quote(holder.principal, total, holder.last_settled_block, height, holder.joined_ts, now);
        holder.owed = holder.owed + reward;
        holder.last_settled_block = pool.block_height;
    }

    /// Pay the share for exactly the newly mined height range. Principal is
    /// deliberately unchanged: rewards are circulating coins, not new stake.
    fun distribute_mined_rewards(
        registry: &mut HolderRegistry,
        pool: &mut RewardPool,
        from_block: u64,
        to_block: u64,
        now: u64,
        ctx: &mut TxContext,
    ) {
        let total = registry.total_principal;
        let mut i = 0;
        let n = vector::length(&registry.addresses);
        while (i < n) {
            let recipient = *vector::borrow(&registry.addresses, i);
            let amount = {
                let holder = table::borrow_mut(&mut registry.holders, recipient);
                let reward = reward_quote(holder.principal, total, from_block, to_block, holder.joined_ts, now);
                holder.last_settled_block = to_block;
                reward
            };
            if (amount > 0) {
                assert!(amount <= balance::value(&pool.rewards), E_INSUFFICIENT_LIQUIDITY);
                let payout = coin::from_balance(balance::split(&mut pool.rewards, amount), ctx);
                transfer::public_transfer(payout, recipient);
            };
            i = i + 1;
        };
    }

    /// Quote rewards using the holder's current age band. Slots are absolute
    /// block heights, making the stagger deterministic across push/claim calls.
    public fun reward_quote(principal: u64, total_principal: u64, from_block: u64, to_block: u64, joined_ts: u64, now_ts: u64): u64 {
        if (principal == 0 || total_principal == 0 || to_block <= from_block) { return 0 };
        let age = if (now_ts > joined_ts) { now_ts - joined_ts } else { 0 };
        let years = age / YEAR_SECS;
        let interval = if (years >= 10) { 11 } else { years + 1 };
        let emission = emission_between_slots(from_block, to_block, interval);
        ((emission as u128) * (principal as u128) / (total_principal as u128)) as u64
    }


    fun emission_between_slots(from_block: u64, to_block: u64, interval: u64): u64 {
        if (to_block <= from_block) { return 0 };
        let mut block = from_block + 1;
        let mut total = 0;
        while (block <= to_block) {
            if (block % interval == 0) { total = total + subsidy_at_height(block - 1) };
            block = block + 1;
        };
        total
    }

    /// Subsidy for the block beginning at `height`; after 64 halvings it is 0.
    public fun subsidy_at_height(height: u64): u64 {
        let era = height / HALVING_INTERVAL;
        if (era >= 64) { return 0 };
        let mut divisor = 1;
        let mut i = 0;
        while (i < era) { divisor = divisor * 2; i = i + 1 };
        INITIAL_SUBSIDY / divisor
    }

    /// Sum [start_height, end_height), split at each halving boundary.
    public fun emission_between(start_height: u64, end_height: u64): u64 {
        if (end_height <= start_height) { return 0 };
        let mut cursor = start_height;
        let mut total = 0;
        while (cursor < end_height) {
            let era = cursor / HALVING_INTERVAL;
            let next_boundary = (era + 1) * HALVING_INTERVAL;
            let stop = if (end_height < next_boundary) { end_height } else { next_boundary };
            total = total + (stop - cursor) * subsidy_at_height(cursor);
            cursor = stop;
        };
        total
    }

    public fun decimals(): u8 { DECIMALS }
    public fun unit(): u64 { UNIT }
    public fun max_supply(): u64 { MAX_SUPPLY }
    public fun genesis_amount(): u64 { GENESIS_AMOUNT }
    public fun initial_subsidy(): u64 { INITIAL_SUBSIDY }
    public fun block_time_secs(): u64 { BLOCK_TIME_SECS }
    public fun halving_interval(): u64 { HALVING_INTERVAL }
    public fun max_catch_up_blocks(): u64 { MAX_CATCH_UP_BLOCKS }
    public fun fee_bps(): u64 { PUSH_FEE_BPS }
    public fun holder_principal(registry: &HolderRegistry, who: address): u64 {
        if (!table::contains(&registry.holders, who)) { return 0 };
        table::borrow(&registry.holders, who).principal
    }
    public fun owed_rewards(registry: &HolderRegistry, who: address): u64 {
        if (!table::contains(&registry.holders, who)) { return 0 };
        table::borrow(&registry.holders, who).owed
    }
    public fun reward_balance(pool: &RewardPool): u64 { balance::value(&pool.rewards) }
    public fun block_height(pool: &RewardPool): u64 { pool.block_height }
    public fun total_minted(pool: &RewardPool): u64 { pool.total_minted }
}
