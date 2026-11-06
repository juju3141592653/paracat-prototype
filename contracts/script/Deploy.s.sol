// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {MockUSDC} from "../src/MockUSDC.sol";
import {TokenisedMMF, IMintableUSD} from "../src/TokenisedMMF.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {FloodOracle} from "../src/FloodOracle.sol";
import {ParaCatProgramme} from "../src/ParaCatProgramme.sol";
import {ParaCatFactory} from "../src/ParaCatFactory.sol";

/// @notice Deploys the full ParaCat stack, issues the first Recovery Notes programme and seeds a
///         demo-ready state. Writes every address to frontend/src/deployments/<chainId>.json.
///
/// Local (Anvil, chain 31337): ten named actors from Anvil's public test mnemonic play Parapet,
/// two oracle feeds, three investors, three insurers and the dispute guardian.
///
/// Public testnet (e.g. Sepolia): your own wallet holds every operational role so one MetaMask
/// account can run the whole demo. Two seed investors and the three insurer treasuries are
/// throwaway demo wallets; the seed investors receive a little test ETH for gas.
contract Deploy is Script {
    string constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
    uint64 constant YEAR = 365 days;

    struct Actors {
        address ops;
        address feedA;
        address feedB;
        address investorA;
        address investorB;
        address liveInvestor;
        address cedentManila;
        address cedentHcmc;
        address cedentJakarta;
        address guardian;
        address treasury;
        uint256 investorAKey;
        uint256 investorBKey;
        uint256 feedBKey;
        uint256 cedentKey;
    }

    struct Deployed {
        MockUSDC usdc;
        TokenisedMMF fund;
        IdentityRegistry registry;
        FloodOracle oracle;
        ParaCatProgramme implementation;
        ParaCatFactory factory;
        ParaCatProgramme programme;
    }

    bytes32 constant MANILA = keccak256("PH-MARIKINA-STO-NINO");
    bytes32 constant HCMC = keccak256("VN-SAIGON-PHU-AN");
    bytes32 constant JAKARTA = keccak256("ID-CILIWUNG-MANGGARAI");

    bool local;
    uint256 startBlock;

    function run() external {
        local = block.chainid == 31337;
        startBlock = block.number;
        Actors memory a = _actors();

        uint64 disputeWindow = uint64(vm.envOr("DISPUTE_WINDOW_SECONDS", uint256(60)));
        uint256 settlementDelay = vm.envOr("FUND_SETTLEMENT_SECONDS", uint256(90));
        uint256 acceleration = vm.envOr("YIELD_TIME_ACCELERATION", uint256(1440));
        uint8 quorum = uint8(vm.envOr("ORACLE_QUORUM", local ? uint256(2) : uint256(1)));

        vm.startBroadcast();
        require(msg.sender == a.ops, "Run with the deployer as the only signer");
        Deployed memory d = _deployCore(a, settlementDelay, acceleration, quorum);
        _setUpIdentities(d, a);
        _setUpOracle(d, a);
        d.programme = _issueProgramme(d, a, disputeWindow);
        _setAllocationPlans(d.programme);

        // Fund the live-demo investor and the insurers' premium budgets.
        d.usdc.mint(a.liveInvestor, 10_000_000e6);
        d.usdc.mint(a.cedentManila, 2_000_000e6);
        d.usdc.mint(a.cedentHcmc, 2_000_000e6);
        d.usdc.mint(a.cedentJakarta, 2_000_000e6);
        if (!local) {
            // Gas money for the throwaway seed investors on a public testnet.
            uint256 gasMoney = vm.envOr("SEED_GAS_WEI", uint256(0.004 ether));
            payable(a.investorA).transfer(gasMoney);
            payable(a.investorB).transfer(gasMoney);
        }
        vm.stopBroadcast();

        _seedReadings(d, a);
        _seedSubscriptions(d, a);
        if (vm.envOr("SEED_ACTIVE", false)) _seedActive(d, a);
        _writeDeployment(d, a, disputeWindow, settlementDelay, acceleration, quorum);
    }

    // ------------------------------------------------------------------ actors

    function _actors() internal view returns (Actors memory a) {
        a.ops = msg.sender;
        a.treasury = vm.envOr("TREASURY", vm.addr(_label("parapet.treasury")));
        if (local) {
            a.ops = vm.addr(vm.deriveKey(ANVIL_MNEMONIC, 0));
            a.feedBKey = vm.deriveKey(ANVIL_MNEMONIC, 2);
            a.investorAKey = vm.deriveKey(ANVIL_MNEMONIC, 3);
            a.investorBKey = vm.deriveKey(ANVIL_MNEMONIC, 4);
            a.cedentKey = vm.deriveKey(ANVIL_MNEMONIC, 6);
            a.feedA = vm.addr(vm.deriveKey(ANVIL_MNEMONIC, 1));
            a.feedB = vm.addr(a.feedBKey);
            a.investorA = vm.addr(a.investorAKey);
            a.investorB = vm.addr(a.investorBKey);
            a.liveInvestor = vm.addr(vm.deriveKey(ANVIL_MNEMONIC, 5));
            a.cedentManila = vm.addr(a.cedentKey);
            a.cedentHcmc = vm.addr(vm.deriveKey(ANVIL_MNEMONIC, 7));
            a.cedentJakarta = vm.addr(vm.deriveKey(ANVIL_MNEMONIC, 8));
            a.guardian = vm.addr(vm.deriveKey(ANVIL_MNEMONIC, 9));
        } else {
            // Your wallet runs the demo; everything else is a deterministic throwaway wallet.
            a.feedA = a.ops;
            a.feedB = vm.envOr("FEED_B", address(0));
            a.liveInvestor = a.ops;
            a.guardian = vm.envOr("GUARDIAN", a.ops);
            a.investorAKey = _label(string.concat("seed.investorA.", vm.toString(a.ops)));
            a.investorBKey = _label(string.concat("seed.investorB.", vm.toString(a.ops)));
            a.investorA = vm.addr(a.investorAKey);
            a.investorB = vm.addr(a.investorBKey);
            a.cedentManila = vm.envOr("CEDENT_MANILA", vm.addr(_label("demo.cedent.manila")));
            a.cedentHcmc = vm.envOr("CEDENT_HCMC", vm.addr(_label("demo.cedent.hcmc")));
            a.cedentJakarta = vm.envOr("CEDENT_JAKARTA", vm.addr(_label("demo.cedent.jakarta")));
        }
    }

    function _label(string memory s) internal pure returns (uint256) {
        return uint256(keccak256(bytes(s)));
    }

    // -------------------------------------------------------------------- core

    function _deployCore(Actors memory a, uint256 settlementDelay, uint256 acceleration, uint8 quorum)
        internal
        returns (Deployed memory d)
    {
        d.usdc = new MockUSDC(a.ops);
        d.fund = new TokenisedMMF(
            a.ops, IMintableUSD(address(d.usdc)), 450, acceleration, 250_000e6, settlementDelay
        );
        d.usdc.grantRole(d.usdc.MINTER_ROLE(), address(d.fund));
        d.registry = new IdentityRegistry(a.ops);
        d.oracle = new FloodOracle(a.ops, quorum, 6 hours);
        d.implementation = new ParaCatProgramme();
        d.factory = new ParaCatFactory(
            a.ops,
            address(d.implementation),
            address(d.usdc),
            address(d.fund),
            address(d.registry),
            address(d.oracle),
            a.treasury,
            50 // 0.50% issuance fee
        );
    }

    function _setUpIdentities(Deployed memory d, Actors memory a) internal {
        uint64 exp = uint64(block.timestamp + 2 * YEAR);
        IdentityRegistry r = d.registry;
        r.registerIdentity(a.investorA, 702, IdentityRegistry.Category.Institution, true, exp, "Straits Pension Fund");
        r.registerIdentity(a.investorB, 702, IdentityRegistry.Category.FamilyOffice, true, exp, "Lion City Family Office");
        r.registerIdentity(
            a.liveInvestor,
            344,
            IdentityRegistry.Category.Institution,
            true,
            exp,
            local ? "Harbour Bay ILS Fund" : "Harbour Bay ILS Fund (your wallet)"
        );
        r.registerIdentity(a.cedentManila, 608, IdentityRegistry.Category.Insurer, false, exp, "Luzon Mutual Insurance");
        r.registerIdentity(a.cedentHcmc, 704, IdentityRegistry.Category.Insurer, false, exp, "Mekong General Insurance");
        r.registerIdentity(
            a.cedentJakarta, 360, IdentityRegistry.Category.Insurer, false, exp, "Nusantara Mutual Assurance"
        );
        r.setCountryRestriction(408, true); // sanctioned jurisdiction example (DPRK)
    }

    function _setUpOracle(Deployed memory d, Actors memory a) internal {
        d.oracle.addStation(MANILA, unicode"Sto. Niño gauge", "Marikina River", "Metro Manila");
        d.oracle.addStation(HCMC, "Phu An station", "Saigon River", "Ho Chi Minh City");
        d.oracle.addStation(JAKARTA, "Manggarai floodgate", "Ciliwung River", "Jakarta");
        d.oracle.addProvider(a.feedA, "Feed A (river gauge telemetry)");
        if (a.feedB != address(0)) d.oracle.addProvider(a.feedB, "Feed B (satellite rainfall)");
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

    function _issueProgramme(Deployed memory d, Actors memory a, uint64 disputeWindow)
        internal
        returns (ParaCatProgramme p)
    {
        ParaCatProgramme.LocationConfig[] memory locs = new ParaCatProgramme.LocationConfig[](3);
        // Thresholds are illustrative, loosely based on each gauge's published alarm levels.
        locs[0] = ParaCatProgramme.LocationConfig({
            name: "Metro Manila",
            country: "Philippines",
            stationId: MANILA,
            cedent: a.cedentManila,
            cedentName: "Luzon Mutual Insurance",
            sublimitBps: 4_000,
            premiumRateBps: 800,
            tiers: _tiers(2_000, 1_700, 3_000, 1_900) // 200mm & 17.0m -> 50%; 300mm & 19.0m -> 100%
        });
        locs[1] = ParaCatProgramme.LocationConfig({
            name: "Ho Chi Minh City",
            country: "Vietnam",
            stationId: HCMC,
            cedent: a.cedentHcmc,
            cedentName: "Mekong General Insurance",
            sublimitBps: 3_500,
            premiumRateBps: 650,
            tiers: _tiers(1_500, 165, 2_500, 180) // 150mm & 1.65m -> 50%; 250mm & 1.80m -> 100%
        });
        locs[2] = ParaCatProgramme.LocationConfig({
            name: "Jakarta",
            country: "Indonesia",
            stationId: JAKARTA,
            cedent: a.cedentJakarta,
            cedentName: "Nusantara Mutual Assurance",
            sublimitBps: 2_500,
            premiumRateBps: 750,
            tiers: _tiers(2_000, 950, 3_000, 1_050) // 200mm & 9.5m -> 50%; 300mm & 10.5m -> 100%
        });

        ParaCatProgramme.ProgrammeConfig memory cfg = ParaCatProgramme.ProgrammeConfig({
            name: "ParaCat Recovery Notes 2026-A",
            symbol: "PRN26A",
            peril: "Asia flood - parametric dual trigger (24h rainfall + river level)",
            admin: a.ops,
            targetSize: 20_000_000e6,
            minSubscription: 250_000e6,
            termSeconds: 3 * YEAR,
            disputeWindow: disputeWindow,
            bufferBps: 2_000,
            servicingFeeBps: 500
        });

        d.usdc.mint(a.ops, 1_000_000e6);
        d.usdc.approve(address(d.factory), d.factory.issuanceFeeFor(cfg.targetSize));
        p = ParaCatProgramme(d.factory.createProgramme(cfg, locs));
        if (a.guardian != a.ops) p.grantRole(p.GUARDIAN_ROLE(), a.guardian);
    }

    function _setAllocationPlans(ParaCatProgramme p) internal {
        string[] memory n = new string[](4);
        uint16[] memory s = new uint16[](4);
        (n[0], n[1], n[2], n[3]) = ("Marikina", "Pasig", "Quezon City", "Cainta & Rizal");
        (s[0], s[1], s[2], s[3]) = (4_000, 2_500, 2_000, 1_500);
        p.setAllocationPlan(0, n, s);
        (n[0], n[1], n[2], n[3]) = ("Thu Duc", "District 7", "Binh Thanh", "Nha Be");
        (s[0], s[1], s[2], s[3]) = (3_500, 2_500, 2_000, 2_000);
        p.setAllocationPlan(1, n, s);
        (n[0], n[1], n[2], n[3]) = ("East Jakarta", "South Jakarta", "Central Jakarta", "North Jakarta");
        (s[0], s[1], s[2], s[3]) = (3_500, 2_500, 2_000, 2_000);
        p.setAllocationPlan(2, n, s);
    }

    // -------------------------------------------------------------------- seed

    /// @dev Baseline (normal-weather) readings so the gauges show live data from the start.
    function _seedReadings(Deployed memory d, Actors memory a) internal {
        uint64 t = uint64(block.timestamp);
        if (local) vm.startBroadcast(vm.deriveKey(ANVIL_MNEMONIC, 1));
        else vm.startBroadcast();
        d.oracle.submitObservation(MANILA, 420, 1_240, t, "gauge-baseline");
        d.oracle.submitObservation(HCMC, 310, 128, t, "gauge-baseline");
        d.oracle.submitObservation(JAKARTA, 380, 720, t, "gauge-baseline");
        vm.stopBroadcast();
        if (!local) return;
        vm.startBroadcast(a.feedBKey);
        d.oracle.submitObservation(MANILA, 455, 1_255, t, "sat-baseline");
        d.oracle.submitObservation(HCMC, 290, 131, t, "sat-baseline");
        d.oracle.submitObservation(JAKARTA, 401, 735, t, "sat-baseline");
        vm.stopBroadcast();
    }

    function _seedSubscriptions(Deployed memory d, Actors memory a) internal {
        if (!vm.envOr("SEED_INVESTORS", true)) return;
        _subscribe(d, a.investorAKey, 8_000_000e6);
        _subscribe(d, a.investorBKey, 4_000_000e6);
    }

    function _subscribe(Deployed memory d, uint256 key, uint256 amount) internal {
        vm.startBroadcast(key);
        d.usdc.faucet(amount);
        d.usdc.approve(address(d.programme), amount);
        d.programme.subscribe(amount);
        vm.stopBroadcast();
    }

    /// @dev Optional rehearsal state (SEED_ACTIVE=true): book filled and closed, first premium paid.
    function _seedActive(Deployed memory d, Actors memory a) internal {
        uint256 liveKey = local ? vm.deriveKey(ANVIL_MNEMONIC, 5) : 0;
        if (local) vm.startBroadcast(liveKey);
        else vm.startBroadcast();
        d.usdc.approve(address(d.programme), 8_000_000e6);
        d.programme.subscribe(8_000_000e6);
        vm.stopBroadcast();

        vm.startBroadcast(a.ops);
        d.programme.closeSubscription();
        vm.stopBroadcast();

        // Luzon Mutual's first quarterly premium: 8m limit x 8% / 4.
        if (local) vm.startBroadcast(a.cedentKey);
        else vm.startBroadcast(a.ops);
        d.usdc.approve(address(d.programme), 160_000e6);
        d.programme.payPremium(0, 160_000e6);
        vm.stopBroadcast();
    }

    // ------------------------------------------------------------------ output

    function _writeDeployment(
        Deployed memory d,
        Actors memory a,
        uint64 disputeWindow,
        uint256 settlementDelay,
        uint256 acceleration,
        uint8 quorum
    ) internal {
        string memory c = "contracts";
        vm.serializeAddress(c, "usdc", address(d.usdc));
        vm.serializeAddress(c, "fund", address(d.fund));
        vm.serializeAddress(c, "registry", address(d.registry));
        vm.serializeAddress(c, "oracle", address(d.oracle));
        vm.serializeAddress(c, "implementation", address(d.implementation));
        vm.serializeAddress(c, "factory", address(d.factory));
        string memory contractsJson = vm.serializeAddress(c, "programme", address(d.programme));

        string memory r = "actors";
        vm.serializeAddress(r, "ops", a.ops);
        vm.serializeAddress(r, "treasury", a.treasury);
        vm.serializeAddress(r, "feedA", a.feedA);
        vm.serializeAddress(r, "feedB", a.feedB);
        vm.serializeAddress(r, "investorA", a.investorA);
        vm.serializeAddress(r, "investorB", a.investorB);
        vm.serializeAddress(r, "liveInvestor", a.liveInvestor);
        vm.serializeAddress(r, "cedentManila", a.cedentManila);
        vm.serializeAddress(r, "cedentHcmc", a.cedentHcmc);
        vm.serializeAddress(r, "cedentJakarta", a.cedentJakarta);
        string memory actorsJson = vm.serializeAddress(r, "guardian", a.guardian);

        string memory p = "params";
        vm.serializeUint(p, "disputeWindow", disputeWindow);
        vm.serializeUint(p, "fundSettlementDelay", settlementDelay);
        vm.serializeUint(p, "yieldTimeAcceleration", acceleration);
        string memory paramsJson = vm.serializeUint(p, "oracleQuorum", quorum);

        string memory root = "deployment";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "startBlock", startBlock);
        vm.serializeString(root, "profile", local ? "local" : "testnet");
        vm.serializeString(root, "contracts", contractsJson);
        vm.serializeString(root, "params", paramsJson);
        string memory json = vm.serializeString(root, "actors", actorsJson);

        string memory path = string.concat("../frontend/src/deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);

        console2.log("ParaCat deployed on chain", block.chainid);
        console2.log("  Factory   ", address(d.factory));
        console2.log("  Programme ", address(d.programme));
        console2.log("  Oracle    ", address(d.oracle));
        console2.log("  Registry  ", address(d.registry));
        console2.log("  Fund      ", address(d.fund));
        console2.log("  tUSDC     ", address(d.usdc));
        console2.log("Frontend config written to", path);
    }
}
