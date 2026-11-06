// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {MockUSDC} from "../src/MockUSDC.sol";
import {TokenisedMMF, IMintableUSD} from "../src/TokenisedMMF.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {FloodOracle} from "../src/FloodOracle.sol";
import {ParaCatProgramme} from "../src/ParaCatProgramme.sol";
import {ParaCatFactory} from "../src/ParaCatFactory.sol";

/// @notice End-to-end and failure-case tests for the ParaCat Recovery Notes stack.
contract ParaCatTest is Test {
    MockUSDC usdc;
    TokenisedMMF fund;
    IdentityRegistry registry;
    FloodOracle oracle;
    ParaCatProgramme implementation;
    ParaCatFactory factory;
    ParaCatProgramme prog;

    address ops = makeAddr("parapetOps");
    address treasury = makeAddr("parapetTreasury");
    address guardian = makeAddr("guardian");
    address feedA = makeAddr("gaugeFeed");
    address feedB = makeAddr("satelliteFeed");
    address alice = makeAddr("straitsPensionFund");
    address bob = makeAddr("lionCityFamilyOffice");
    address carol = makeAddr("unverifiedWallet");
    address manilaInsurer = makeAddr("luzonMutual");
    address hcmcInsurer = makeAddr("mekongGeneral");
    address jakartaInsurer = makeAddr("nusantaraMutual");

    bytes32 constant MANILA = keccak256("PH-MARIKINA-STO-NINO");
    bytes32 constant HCMC = keccak256("VN-SAIGON-PHU-AN");
    bytes32 constant JAKARTA = keccak256("ID-CILIWUNG-MANGGARAI");

    uint256 constant TARGET = 20_000_000e6;
    uint64 constant TERM = 365 days;
    uint64 constant DISPUTE = 72 hours;
    uint256 constant INSTANT_LIMIT = 250_000e6;
    uint256 constant SETTLEMENT = 1 days;

    function setUp() public {
        vm.warp(1_767_225_600); // 1 Jan 2026
        vm.startPrank(ops);
        usdc = new MockUSDC(ops);
        fund = new TokenisedMMF(ops, IMintableUSD(address(usdc)), 450, 1, INSTANT_LIMIT, SETTLEMENT);
        usdc.grantRole(usdc.MINTER_ROLE(), address(fund));
        registry = new IdentityRegistry(ops);
        oracle = new FloodOracle(ops, 2, 6 hours);
        implementation = new ParaCatProgramme();
        factory = new ParaCatFactory(
            ops, address(implementation), address(usdc), address(fund), address(registry), address(oracle), treasury, 50
        );

        uint64 kycExpiry = uint64(block.timestamp + 730 days);
        registry.registerIdentity(alice, 702, IdentityRegistry.Category.Institution, true, kycExpiry, "Straits Pension Fund");
        registry.registerIdentity(bob, 702, IdentityRegistry.Category.FamilyOffice, true, kycExpiry, "Lion City FO");
        // Insurers pass KYC but are counterparties, not eligible note holders.
        registry.registerIdentity(manilaInsurer, 608, IdentityRegistry.Category.Insurer, false, kycExpiry, "Luzon Mutual");

        oracle.addStation(MANILA, "Sto. Nino gauge", "Marikina River", "Metro Manila");
        oracle.addStation(HCMC, "Phu An station", "Saigon River", "Ho Chi Minh City");
        oracle.addStation(JAKARTA, "Manggarai floodgate", "Ciliwung River", "Jakarta");
        oracle.addProvider(feedA, "River gauge telemetry");
        oracle.addProvider(feedB, "Satellite rainfall");

        usdc.mint(ops, 1_000_000e6);
        usdc.approve(address(factory), type(uint256).max);
        prog = ParaCatProgramme(factory.createProgramme(_config(), _locations()));
        prog.grantRole(prog.GUARDIAN_ROLE(), guardian);
        vm.stopPrank();

        _fund(alice, 15_000_000e6);
        _fund(bob, 10_000_000e6);
        _fund(carol, 1_000_000e6);
        _fund(manilaInsurer, 5_000_000e6);
    }

    // ------------------------------------------------------------ helpers

    function _config() internal view returns (ParaCatProgramme.ProgrammeConfig memory) {
        return ParaCatProgramme.ProgrammeConfig({
            name: "ParaCat Recovery Notes 2026-A",
            symbol: "PRN26A",
            peril: "Flood (parametric: 24h rainfall + river level)",
            admin: ops,
            targetSize: uint128(TARGET),
            minSubscription: 250_000e6,
            termSeconds: TERM,
            disputeWindow: DISPUTE,
            bufferBps: 2_000,
            servicingFeeBps: 500
        });
    }

    function _tiers(uint32 r1, uint32 l1, uint32 r2, uint32 l2)
        internal
        pure
        returns (ParaCatProgramme.Tier[] memory t)
    {
        t = new ParaCatProgramme.Tier[](2);
        t[0] = ParaCatProgramme.Tier({rainfallMmX10: r1, riverLevelCm: l1, payoutBps: 5_000});
        t[1] = ParaCatProgramme.Tier({rainfallMmX10: r2, riverLevelCm: l2, payoutBps: 10_000});
    }

    function _locations() internal view returns (ParaCatProgramme.LocationConfig[] memory locs) {
        locs = new ParaCatProgramme.LocationConfig[](3);
        locs[0] = ParaCatProgramme.LocationConfig({
            name: "Metro Manila",
            country: "Philippines",
            stationId: MANILA,
            cedent: manilaInsurer,
            cedentName: "Luzon Mutual Insurance",
            sublimitBps: 4_000,
            premiumRateBps: 800,
            tiers: _tiers(2_000, 1_600, 3_000, 1_800)
        });
        locs[1] = ParaCatProgramme.LocationConfig({
            name: "Ho Chi Minh City",
            country: "Vietnam",
            stationId: HCMC,
            cedent: hcmcInsurer,
            cedentName: "Mekong General Insurance",
            sublimitBps: 3_500,
            premiumRateBps: 650,
            tiers: _tiers(1_500, 170, 2_500, 185)
        });
        locs[2] = ParaCatProgramme.LocationConfig({
            name: "Jakarta",
            country: "Indonesia",
            stationId: JAKARTA,
            cedent: jakartaInsurer,
            cedentName: "Nusantara Mutual Assurance",
            sublimitBps: 2_500,
            premiumRateBps: 750,
            tiers: _tiers(2_000, 950, 3_000, 1_050)
        });
    }

    function _fund(address who, uint256 amount) internal {
        vm.prank(ops);
        usdc.mint(who, amount);
        vm.prank(who);
        usdc.approve(address(prog), type(uint256).max);
    }

    function _subscribeAndClose() internal {
        vm.prank(alice);
        prog.subscribe(12_000_000e6);
        vm.prank(bob);
        prog.subscribe(8_000_000e6);
        vm.prank(ops);
        prog.closeSubscription();
    }

    function _report(bytes32 station, uint32 rainA, uint32 levelA, uint32 rainB, uint32 levelB) internal {
        vm.prank(feedA);
        oracle.submitObservation(station, rainA, levelA, uint64(block.timestamp), "gauge-bulletin");
        vm.prank(feedB);
        oracle.submitObservation(station, rainB, levelB, uint64(block.timestamp), "satellite-pass");
    }

    // ------------------------------------------------------- issuance

    function test_FactoryIssuesProgrammeAndChargesFee() public view {
        assertEq(factory.programmeCount(), 1);
        assertEq(factory.getProgrammes()[0], address(prog));
        assertEq(usdc.balanceOf(treasury), 100_000e6); // 0.5% of 20m
        assertEq(prog.name(), "ParaCat Recovery Notes 2026-A");
        assertEq(prog.symbol(), "PRN26A");
        assertEq(prog.decimals(), 6);
        assertEq(prog.locationLimit(0), 8_000_000e6);
        assertEq(prog.locationLimit(1), 7_000_000e6);
        assertEq(prog.locationLimit(2), 5_000_000e6);
    }

    function test_TemplateCannotBeReinitialised() public {
        vm.expectRevert(ParaCatProgramme.AlreadyInitialised.selector);
        implementation.initialize(_config(), _infra(), _locations());
        vm.expectRevert(ParaCatProgramme.AlreadyInitialised.selector);
        prog.initialize(_config(), _infra(), _locations());
    }

    function test_RejectsSublimitsNotSummingToOneHundredPercent() public {
        ParaCatProgramme.LocationConfig[] memory locs = _locations();
        locs[2].sublimitBps = 2_000;
        vm.startPrank(ops);
        vm.expectRevert(ParaCatProgramme.InvalidConfig.selector);
        factory.createProgramme(_config(), locs);
        vm.stopPrank();
    }

    function _infra() internal view returns (ParaCatProgramme.Infrastructure memory) {
        return ParaCatProgramme.Infrastructure({
            usdc: address(usdc),
            fund: address(fund),
            registry: address(registry),
            oracle: address(oracle),
            platformTreasury: treasury
        });
    }

    // --------------------------------------------------- subscription

    function test_OnlyVerifiedInvestorsCanSubscribe() public {
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(ParaCatProgramme.NotVerified.selector, carol));
        prog.subscribe(1_000_000e6);

        vm.prank(manilaInsurer); // KYC'd but not an accredited investor
        vm.expectRevert(abi.encodeWithSelector(ParaCatProgramme.NotVerified.selector, manilaInsurer));
        prog.subscribe(1_000_000e6);
    }

    function test_SubscriptionMinimumAndCap() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ParaCatProgramme.BelowMinimum.selector, 250_000e6));
        prog.subscribe(100_000e6);

        vm.prank(alice);
        prog.subscribe(15_000_000e6);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ParaCatProgramme.ExceedsTarget.selector, 5_000_000e6));
        prog.subscribe(6_000_000e6);
        vm.prank(bob);
        prog.subscribe(5_000_000e6);
        assertEq(prog.totalSupply(), TARGET);
        assertEq(prog.balanceOf(alice), 15_000_000e6);
    }

    function test_ExpiredKycBlocksSubscription() public {
        vm.warp(block.timestamp + 731 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ParaCatProgramme.NotVerified.selector, alice));
        prog.subscribe(1_000_000e6);
    }

    function test_CloseSplitsCollateralIntoBufferAndFund() public {
        _subscribeAndClose();
        ParaCatProgramme.ProgrammeView memory v = prog.programmeInfo();
        assertEq(uint8(v.phase), uint8(ParaCatProgramme.Phase.Active));
        assertEq(v.principal, TARGET);
        assertEq(v.bufferBalance, 4_000_000e6);
        assertEq(v.fundValue, 16_000_000e6);
        assertEq(fund.balanceOf(address(prog)), 16_000_000e6);
        assertEq(v.riskEnd, v.riskStart + TERM);
    }

    function test_OnlyManagerCanClose() public {
        vm.prank(alice);
        prog.subscribe(1_000_000e6);
        vm.expectRevert();
        vm.prank(alice);
        prog.closeSubscription();
    }

    // ------------------------------------------------------ compliance

    function test_TransferRestrictions() public {
        _subscribeAndClose();

        assertEq(prog.canTransfer(alice, bob, 1e6), 0);
        assertEq(prog.canTransfer(alice, carol, 1e6), 4);
        assertEq(prog.canTransfer(alice, manilaInsurer, 1e6), 4);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ParaCatProgramme.NotVerified.selector, carol));
        prog.transfer(carol, 1_000_000e6);

        vm.prank(alice);
        prog.transfer(bob, 1_000_000e6);
        assertEq(prog.balanceOf(bob), 9_000_000e6);

        vm.prank(ops);
        prog.setFrozen(alice, true);
        assertEq(prog.canTransfer(alice, bob, 1e6), 2);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ParaCatProgramme.AccountFrozen.selector, alice));
        prog.transfer(bob, 1e6);

        // Transfer agent recovers notes from a frozen (e.g. compromised) wallet.
        vm.prank(ops);
        prog.forcedTransfer(alice, bob, 2_000_000e6);
        assertEq(prog.balanceOf(bob), 11_000_000e6);
    }

    function test_RestrictedCountryBlocksTransfers() public {
        _subscribeAndClose();
        vm.prank(ops);
        registry.setCountryRestriction(702, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ParaCatProgramme.NotVerified.selector, bob));
        prog.transfer(bob, 1e6);
    }

    // ---------------------------------------------------------- coupons

    function test_PremiumBecomesCouponProRataAfterServicingFee() public {
        _subscribeAndClose();
        uint256 quarterly = 160_000e6; // 8m limit x 8% / 4
        vm.prank(manilaInsurer);
        usdc.approve(address(prog), quarterly);
        vm.prank(manilaInsurer);
        prog.payPremium(0, quarterly);

        assertEq(usdc.balanceOf(treasury), 100_000e6 + 8_000e6); // issuance fee + 5% servicing
        uint256 toHolders = 152_000e6;
        assertApproxEqAbs(prog.pendingCoupon(alice), (toHolders * 12) / 20, 2);
        assertApproxEqAbs(prog.pendingCoupon(bob), (toHolders * 8) / 20, 2);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        prog.claimCoupon();
        assertApproxEqAbs(usdc.balanceOf(alice) - before, 91_200e6, 2);
        assertEq(prog.pendingCoupon(alice), 0);
    }

    function test_AccruedCouponStaysWithSellerAfterTransfer() public {
        _subscribeAndClose();
        vm.prank(manilaInsurer);
        prog.payPremium(0, 100_000e6);
        uint256 aliceBefore = prog.pendingCoupon(alice);

        vm.prank(alice);
        prog.transfer(bob, 12_000_000e6);
        assertApproxEqAbs(prog.pendingCoupon(alice), aliceBefore, 1);

        vm.prank(manilaInsurer);
        prog.payPremium(0, 100_000e6);
        assertApproxEqAbs(prog.pendingCoupon(alice), aliceBefore, 1); // no new accrual without notes
        assertApproxEqAbs(prog.pendingCoupon(bob), 95_000e6 * 8 / 20 + 95_000e6, 3);
    }

    function test_CollateralYieldIsDistributedAsCoupon() public {
        _subscribeAndClose();
        vm.warp(block.timestamp + 30 days);
        uint256 excess = prog.excessCollateral();
        // 16m in the fund at 4.5% for 30 days ~= 59.2k
        assertApproxEqRel(excess, 59_178e6, 0.001e18);
        prog.distributeCollateralYield();
        assertApproxEqAbs(prog.excessCollateral(), 0, 5);
        assertApproxEqRel(prog.pendingCoupon(alice), (excess * 12) / 20, 0.0001e18);
        // principal stays fully collateralised
        assertGe(prog.bufferBalance() + prog.fundValue(), prog.remainingPrincipal());
    }

    // ---------------------------------------------------------- triggers

    function test_OracleNeedsQuorum() public {
        _subscribeAndClose();
        vm.prank(feedA);
        oracle.submitObservation(MANILA, 3_500, 1_900, uint64(block.timestamp), "gauge");
        vm.expectRevert(ParaCatProgramme.OracleNotReady.selector);
        prog.checkTrigger(0);
    }

    function test_DualTriggerNeedsBothRainAndRiver() public {
        _subscribeAndClose();
        // Extreme rain but the river stays below the threshold: no payout.
        _report(MANILA, 4_000, 1_500, 4_200, 1_520);
        vm.expectRevert(ParaCatProgramme.NoNewTrigger.selector);
        prog.checkTrigger(0);
    }

    function test_LowerMedianStopsOneFaultyFeedForcingPayout() public {
        _subscribeAndClose();
        // Feed B is faulty and reports an extreme flood; feed A sees normal conditions.
        _report(MANILA, 400, 1_200, 5_000, 2_200);
        vm.expectRevert(ParaCatProgramme.NoNewTrigger.selector);
        prog.checkTrigger(0);
    }

    function test_StaleObservationRejected() public {
        _subscribeAndClose();
        vm.prank(feedA);
        vm.expectRevert(FloodOracle.StaleObservation.selector);
        oracle.submitObservation(MANILA, 3_000, 1_800, uint64(block.timestamp - 7 hours), "old");
    }

    function test_Tier2PayoutPaysBufferInstantlyThenQueuesFundTranche() public {
        _subscribeAndClose();
        vm.prank(ops);
        string[] memory names = new string[](3);
        names[0] = "Marikina";
        names[1] = "Pasig";
        names[2] = "Quezon City";
        uint16[] memory shares = new uint16[](3);
        shares[0] = 4_500;
        shares[1] = 3_000;
        shares[2] = 2_500;
        prog.setAllocationPlan(0, names, shares);

        _report(MANILA, 3_200, 1_850, 3_400, 1_880); // tier 2 on both metrics
        prog.checkTrigger(0);
        ParaCatProgramme.LocationView memory lv = prog.getLocation(0);
        assertTrue(lv.pending.active);
        assertEq(lv.pending.targetBps, 10_000);
        assertEq(lv.pending.rainfallMmX10, 3_200); // lower median of the two feeds

        vm.expectRevert(
            abi.encodeWithSelector(ParaCatProgramme.DisputeWindowOpen.selector, uint64(block.timestamp + DISPUTE))
        );
        prog.executePayout(0);

        vm.warp(block.timestamp + DISPUTE);
        vm.expectEmit(true, false, false, true, address(prog));
        emit ParaCatProgramme.RecoveryAllocation(0, 0, "Marikina", 3_600_000e6);
        prog.executePayout(0);

        // 8m payout: 4m instantly from the buffer, 4m queued with the fund.
        assertEq(usdc.balanceOf(manilaInsurer), 5_000_000e6 + 4_000_000e6);
        assertEq(prog.bufferBalance(), 0);
        ParaCatProgramme.PayoutRequest[] memory reqs = prog.getPayoutRequests();
        assertEq(reqs.length, 1);
        assertEq(reqs[0].amount, 4_000_000e6);

        vm.expectRevert();
        prog.settlePayout(0); // fund has not settled yet

        vm.warp(block.timestamp + SETTLEMENT);
        prog.settlePayout(0);
        assertEq(usdc.balanceOf(manilaInsurer), 5_000_000e6 + 8_000_000e6);
        assertEq(prog.remainingPrincipal(), 12_000_000e6);

        vm.expectRevert(ParaCatProgramme.AlreadySettled.selector);
        prog.settlePayout(0);
    }

    function test_Tier1ThenEscalationToTier2() public {
        _subscribeAndClose();
        _report(MANILA, 2_300, 1_650, 2_400, 1_700);
        prog.checkTrigger(0);
        vm.warp(block.timestamp + DISPUTE);
        prog.executePayout(0);
        assertEq(usdc.balanceOf(manilaInsurer), 5_000_000e6 + 4_000_000e6);
        assertEq(prog.getLocation(0).location.paidBps, 5_000);

        // Same tier again does nothing.
        _report(MANILA, 2_300, 1_650, 2_400, 1_700);
        vm.expectRevert(ParaCatProgramme.NoNewTrigger.selector);
        prog.checkTrigger(0);

        // The flood worsens: tier 2 pays the remaining 50%.
        _report(MANILA, 3_100, 1_820, 3_300, 1_840);
        prog.checkTrigger(0);
        vm.warp(block.timestamp + DISPUTE);
        prog.executePayout(0);
        vm.warp(block.timestamp + SETTLEMENT);
        prog.settlePayout(0);
        assertEq(usdc.balanceOf(manilaInsurer), 5_000_000e6 + 8_000_000e6);
        assertEq(prog.getLocation(0).location.paidBps, 10_000);
    }

    function test_GuardianCanDisputeWithinWindowOnly() public {
        _subscribeAndClose();
        _report(MANILA, 3_200, 1_850, 3_400, 1_880);
        prog.checkTrigger(0);

        vm.prank(alice);
        vm.expectRevert();
        prog.disputeTrigger(0, "not a guardian");

        vm.prank(guardian);
        prog.disputeTrigger(0, "Gauge recalibration: reading invalid");
        assertFalse(prog.getLocation(0).pending.active);
        vm.expectRevert(ParaCatProgramme.NoPendingTrigger.selector);
        prog.executePayout(0);

        prog.checkTrigger(0); // re-proposed from the same consensus
        vm.warp(block.timestamp + DISPUTE);
        vm.prank(guardian);
        vm.expectRevert(ParaCatProgramme.DisputeWindowClosed.selector);
        prog.disputeTrigger(0, "too late");
    }

    function test_ConfirmedPayoutCannotBeBlockedByPause() public {
        _subscribeAndClose();
        _report(MANILA, 2_300, 1_650, 2_400, 1_700);
        prog.checkTrigger(0);
        vm.prank(guardian);
        prog.pause();
        vm.warp(block.timestamp + DISPUTE);
        prog.executePayout(0);
        assertEq(usdc.balanceOf(manilaInsurer), 9_000_000e6);
    }

    function test_EventsAfterRiskPeriodAreNotCovered() public {
        _subscribeAndClose();
        vm.warp(block.timestamp + TERM + 1);
        _report(MANILA, 3_200, 1_850, 3_400, 1_880);
        vm.expectRevert(ParaCatProgramme.RiskPeriodEnded.selector);
        prog.checkTrigger(0);
    }

    function test_AllocationPlanRules() public {
        _subscribeAndClose();
        string[] memory names = new string[](2);
        names[0] = "Marikina";
        names[1] = "Pasig";
        uint16[] memory shares = new uint16[](2);
        shares[0] = 6_000;
        shares[1] = 3_000;

        vm.prank(manilaInsurer);
        vm.expectRevert(ParaCatProgramme.InvalidConfig.selector);
        prog.setAllocationPlan(0, names, shares); // only 90%

        shares[1] = 4_000;
        vm.prank(alice);
        vm.expectRevert(ParaCatProgramme.NotCedentOrManager.selector);
        prog.setAllocationPlan(0, names, shares);

        vm.prank(manilaInsurer);
        prog.setAllocationPlan(0, names, shares);
        assertEq(prog.getLocation(0).districts.length, 2);
    }

    // ---------------------------------------------------------- maturity

    function test_MaturityRepaysPrincipalPlusYield() public {
        _subscribeAndClose();
        vm.warp(block.timestamp + TERM + 1);
        prog.beginMaturity();
        vm.expectRevert();
        prog.finaliseMaturity();
        vm.warp(block.timestamp + SETTLEMENT);
        prog.finaliseMaturity();

        uint256 pool = prog.redemptionPool();
        assertGt(pool, TARGET); // a year of fund yield on 16m on top of principal
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        prog.redeem(12_000_000e6);
        assertApproxEqAbs(usdc.balanceOf(alice) - before, (pool * 12) / 20, 1);
    }

    function test_MaturityAfterPayoutReflectsLoss() public {
        _subscribeAndClose();
        _report(MANILA, 2_300, 1_650, 2_400, 1_700); // tier 1: 4m paid
        prog.checkTrigger(0);
        vm.warp(block.timestamp + DISPUTE);
        prog.executePayout(0);

        assertEq(prog.accountInfo(alice).redeemableValue, 9_600_000e6); // 12m x 16/20

        vm.warp(block.timestamp + TERM);
        prog.beginMaturity();
        vm.warp(block.timestamp + SETTLEMENT);
        prog.finaliseMaturity();
        uint256 pool = prog.redemptionPool();
        assertGt(pool, 16_000_000e6);
        assertLt(pool, 17_000_000e6);
    }

    function test_CannotMatureWithPendingTrigger() public {
        _subscribeAndClose();
        vm.warp(block.timestamp + TERM - 1 hours);
        _report(MANILA, 3_200, 1_850, 3_400, 1_880);
        prog.checkTrigger(0);
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(abi.encodeWithSelector(ParaCatProgramme.TriggerPending.selector, 0));
        prog.beginMaturity();
    }

    // -------------------------------------------------------------- fuzz

    /// @dev Coupons owed to holders can never exceed the cash reserved for them.
    function testFuzz_CouponsNeverExceedReserve(uint96 a, uint96 b, uint96 premium, uint96 moved) public {
        uint256 subA = bound(a, 250_000e6, 12_000_000e6);
        uint256 subB = bound(b, 250_000e6, TARGET - subA);
        _fund(bob, 20_000_000e6);
        vm.prank(alice);
        prog.subscribe(subA);
        vm.prank(bob);
        prog.subscribe(subB);
        vm.prank(ops);
        prog.closeSubscription();

        uint256 p = bound(premium, 1e6, 1_000_000e6);
        vm.prank(manilaInsurer);
        prog.payPremium(0, p);
        vm.prank(alice);
        prog.transfer(bob, bound(moved, 0, subA));
        vm.prank(manilaInsurer);
        prog.payPremium(1, p);

        assertLe(prog.pendingCoupon(alice) + prog.pendingCoupon(bob), prog.couponReserve());
    }
}
