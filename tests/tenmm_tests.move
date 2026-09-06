#[test_only]
module ten_min_mine::tenmm_tests {
    use ten_min_mine::tenmm;

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
}
