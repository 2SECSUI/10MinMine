#[test_only]
module ten_min_mine::tenmm_tests {
    use ten_min_mine::tenmm;
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::test_scenario;

    #[test]
    fun hard_cap_and_policy_constants() {
        assert!(tenmm::decimals() == 8, 0);
        assert!(tenmm::unit() == 100_000_000, 1);
        assert!(tenmm::max_supply() == 2_100_000_000_000_000, 2);
        assert!(tenmm::genesis_amount() == 5_000_000_000, 3);
        assert!(tenmm::initial_subsidy() == 5_000_000_000, 4);
        assert!(tenmm::block_time_secs() == 600, 5);
        assert!(tenmm::halving_interval() == 210_000, 6);
        assert!(tenmm::max_catch_up_blocks() == 1008, 7);
    }

    #[test]
    fun halving_boundaries_are_exact() {
        assert!(tenmm::subsidy_at_height(0) == 5_000_000_000, 10);
        assert!(tenmm::subsidy_at_height(209_999) == 5_000_000_000, 11);
        assert!(tenmm::subsidy_at_height(210_000) == 2_500_000_000, 12);
        assert!(tenmm::emission_between(209_999, 210_001) == 7_500_000_000, 13);
    }

    #[test]
    fun catch_up_limit_is_locked() {
        assert!(tenmm::max_catch_up_blocks() == 1008, 20);
        assert!(tenmm::block_time_secs() == 600, 21);
    }

    #[test]
    fun claim_quote_and_stagger() {
        // A sole new holder receives every eligible block in this quote.
        assert!(tenmm::reward_quote(100, 100, 0, 3, 1000, 1000) == 15_000_000_000, 30);
        // A ten-year holder is paid once every 11th block.
        let ten_years = 31_536_000 * 10;
        assert!(tenmm::reward_quote(100, 100, 0, 22, 0, ten_years) == 10_000_000_000, 31);
    }

    #[test]
    fun overflow_safe_reward_quote() {
        assert!(tenmm::reward_quote(5_000_000_000, 5_000_000_000, 0, 1, 0, 0) == 5_000_000_000, 40);
    }

    #[test]
    fun mine_pays_holders_directly() {
        let alice = @0xA;
        let mut scenario = test_scenario::begin(alice);
        tenmm::initialize_for_testing(scenario.ctx());
        scenario.create_system_objects();
        {
            let mut pool = scenario.take_shared<tenmm::RewardPool>();
            let mut registry = scenario.take_shared<tenmm::HolderRegistry>();
            let mut fee_pot = scenario.take_shared<tenmm::FeePot>();
            let clock_obj = scenario.take_shared<Clock>();
            tenmm::mine(&mut pool, &mut registry, &mut fee_pot, &clock_obj, scenario.ctx());
            test_scenario::return_shared(pool);
            test_scenario::return_shared(registry);
            test_scenario::return_shared(fee_pot);
            test_scenario::return_shared(clock_obj);
        };
        scenario.next_tx(alice);
        let first = scenario.take_from_sender<Coin<tenmm::TENMM>>();
        assert!(coin::value(&first) == 5_000_000_000, 41);
        scenario.return_to_sender(first);
        {
            let mut pool = scenario.take_shared<tenmm::RewardPool>();
            let mut registry = scenario.take_shared<tenmm::HolderRegistry>();
            let mut fee_pot = scenario.take_shared<tenmm::FeePot>();
            let mut clock_obj = scenario.take_shared<Clock>();
            clock::set_for_testing(&mut clock_obj, 600_000);
            tenmm::mine(&mut pool, &mut registry, &mut fee_pot, &clock_obj, scenario.ctx());
            test_scenario::return_shared(pool);
            test_scenario::return_shared(registry);
            test_scenario::return_shared(fee_pot);
            test_scenario::return_shared(clock_obj);
        };
        scenario.next_tx(alice);
        let reward = scenario.take_from_sender<Coin<tenmm::TENMM>>();
        assert!(coin::value(&reward) == 5_000_000_000, 42);
        scenario.return_to_sender(reward);
        {
            let registry = scenario.take_shared<tenmm::HolderRegistry>();
            assert!(tenmm::holder_principal(&registry, alice) == 5_000_000_000, 43);
            assert!(tenmm::owed_rewards(&registry, alice) == 0, 44);
            test_scenario::return_shared(registry);
        };
        {
            let pool = scenario.take_shared<tenmm::RewardPool>();
            assert!(tenmm::reward_balance(&pool) == 0, 45);
            test_scenario::return_shared(pool);
        };
        scenario.end();
    }

    #[test]
    fun seed_liquidity_debits_registry_principal() {
        let alice = @0xB;
        let mut scenario = test_scenario::begin(alice);
        tenmm::initialize_for_testing(scenario.ctx());
        scenario.create_system_objects();
        {
            let mut pool = scenario.take_shared<tenmm::RewardPool>();
            let mut registry = scenario.take_shared<tenmm::HolderRegistry>();
            let mut fee_pot = scenario.take_shared<tenmm::FeePot>();
            let clock_obj = scenario.take_shared<Clock>();
            tenmm::mine(&mut pool, &mut registry, &mut fee_pot, &clock_obj, scenario.ctx());
            test_scenario::return_shared(pool);
            test_scenario::return_shared(registry);
            test_scenario::return_shared(fee_pot);
            test_scenario::return_shared(clock_obj);
        };
        scenario.next_tx(alice);
        let mut tenmm_coin = scenario.take_from_sender<Coin<tenmm::TENMM>>();
        let seeded_coin = coin::split(&mut tenmm_coin, 1_000_000_000, scenario.ctx());
        scenario.return_to_sender(tenmm_coin);
        let sui_coin = coin::mint_for_testing<SUI>(100, scenario.ctx());
        {
            let mut market = scenario.take_shared<tenmm::Market>();
            let pool = scenario.take_shared<tenmm::RewardPool>();
            let mut registry = scenario.take_shared<tenmm::HolderRegistry>();
            let clock_obj = scenario.take_shared<Clock>();
            tenmm::seed_liquidity(&mut market, &pool, &mut registry, sui_coin, seeded_coin, &clock_obj, scenario.ctx());
            test_scenario::return_shared(market);
            test_scenario::return_shared(pool);
            test_scenario::return_shared(registry);
            test_scenario::return_shared(clock_obj);
        };
        scenario.next_tx(alice);
        {
            let registry = scenario.take_shared<tenmm::HolderRegistry>();
            assert!(tenmm::holder_principal(&registry, alice) == 4_000_000_000, 46);
            test_scenario::return_shared(registry);
        };
        scenario.end();
    }
}
