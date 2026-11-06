// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {TokenisedMMF} from "./TokenisedMMF.sol";
import {IdentityRegistry} from "./IdentityRegistry.sol";
import {FloodOracle} from "./FloodOracle.sol";

/// @title ParaCat Recovery Notes programme
/// @notice One tokenised, pooled, parametric catastrophe-bond programme. A single contract plays
///         the roles a traditional cat bond spreads across an SPV, a trustee and a paying agent:
///
///   1. Permissioned note (ERC-20 + ERC-3643-style compliance). Only wallets the identity registry
///      marks as KYC'd, accredited and in a permitted country can hold or receive notes. The
///      transfer agent can freeze wallets or force a transfer (e.g. lost keys, court order).
///   2. Pooled cover. Several locations (each a city, its river gauge and the insurer ceding the
///      risk) share one note. Each has a sub-limit and a premium rate, so investors diversify
///      across catchments and insurers share structuring costs.
///   3. Collateral vault. Investor principal is split into an instant stablecoin buffer and a
///      yield-bearing tokenised money-market fund, visible on-chain at all times.
///   4. Parametric dual trigger with tiers. A tier is met only when BOTH 24h rainfall AND river
///      level reach its thresholds (reduces basis risk). Tier 1 might pay 50% of a location's
///      sub-limit, tier 2 the full 100%.
///   5. Dispute window. A trigger is first proposed; an independent guardian can challenge a
///      faulty reading before the payout becomes executable. Once the window has passed nobody,
///      not even the issuer, can block the payout.
///   6. Payout ends at the insurer's wallet. The buffer pays instantly; the remainder follows when
///      the fund settles. The insurer's pre-agreed district split is recorded for transparency,
///      but distributing funds to districts is the insurer's own responsibility.
///   7. Coupon engine. Insurer premiums (minus Parapet's servicing fee) and collateral yield are
///      distributed pro rata to note holders, who claim them at any time.
///   8. Maturity. After the risk period, remaining collateral is redeemed and holders redeem notes.
///
/// @dev Deployed once as an implementation and cloned per programme (EIP-1167) by ParaCatFactory,
///      so every programme runs the same audited code. 1 note = 1 tUSDC of face value (6 decimals).
contract ParaCatProgramme is ERC20, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ----------------------------------------------------------------- roles

    /// @notice Parapet as calculation and servicing agent.
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    /// @notice Transfer agent: freeze wallets, forced transfers.
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    /// @notice Independent dispute committee: can challenge a proposed trigger and pause in an emergency.
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    uint16 public constant BPS = 10_000;
    uint256 public constant MAX_LOCATIONS = 6;
    uint256 public constant MAX_TIERS = 3;
    uint256 public constant MAX_DISTRICTS = 8;
    uint256 private constant ACC = 1e18;

    // ----------------------------------------------------------------- types

    enum Phase {
        Subscription,
        Active,
        Maturing,
        Matured
    }

    struct Tier {
        uint32 rainfallMmX10; // 24h rainfall threshold, tenths of a millimetre
        uint32 riverLevelCm; // river level threshold, centimetres
        uint16 payoutBps; // cumulative share of the location's sub-limit paid at this tier
    }

    struct District {
        string name;
        uint16 shareBps;
    }

    struct Location {
        string name; // e.g. "Metro Manila"
        string country; // e.g. "Philippines"
        bytes32 stationId; // oracle station
        address cedent; // insurer's treasury wallet that receives payouts
        string cedentName;
        uint16 sublimitBps; // share of programme principal covering this location
        uint16 premiumRateBps; // annual premium (rate on line) paid by the cedent
        uint16 paidBps; // cumulative share of the sub-limit already paid out
        uint128 premiumsPaid;
        uint128 totalPaidOut;
    }

    struct PendingTrigger {
        bool active;
        uint8 tierIndex;
        uint16 targetBps;
        uint64 proposedAt;
        uint64 executableAt;
        uint32 rainfallMmX10;
        uint32 riverLevelCm;
        uint64 observedAt;
        uint8 sources;
    }

    struct PayoutRequest {
        uint8 locationId;
        uint128 amount;
        uint256 fundRequestId;
        uint64 requestedAt;
        bool settled;
    }

    struct LocationConfig {
        string name;
        string country;
        bytes32 stationId;
        address cedent;
        string cedentName;
        uint16 sublimitBps;
        uint16 premiumRateBps;
        Tier[] tiers;
    }

    struct ProgrammeConfig {
        string name;
        string symbol;
        string peril;
        address admin;
        uint128 targetSize;
        uint128 minSubscription;
        uint64 termSeconds;
        uint64 disputeWindow;
        uint16 bufferBps;
        uint16 servicingFeeBps;
    }

    struct Infrastructure {
        address usdc;
        address fund;
        address registry;
        address oracle;
        address platformTreasury;
    }

    struct ProgrammeView {
        string name;
        string symbol;
        string peril;
        Phase phase;
        uint256 targetSize;
        uint256 minSubscription;
        uint256 totalSubscribed;
        uint256 principal;
        uint256 totalPaidOut;
        uint256 remainingPrincipal;
        uint64 riskStart;
        uint64 riskEnd;
        uint64 termSeconds;
        uint64 disputeWindow;
        uint16 bufferBps;
        uint16 servicingFeeBps;
        uint256 bufferBalance;
        uint256 fundShares;
        uint256 fundValue;
        uint256 excessCollateral;
        uint256 couponReserve;
        uint256 totalPremiums;
        uint256 totalFees;
        uint256 totalCollateralYield;
        uint256 totalCouponsDistributed;
        uint256 redemptionPool;
        uint256 supplyAtMaturity;
        uint256 locationCount;
        uint256 payoutRequestCount;
        bool paused;
    }

    struct LocationView {
        Location location;
        Tier[] tiers;
        District[] districts;
        PendingTrigger pending;
        uint256 limit;
        uint256 annualPremium;
    }

    struct AccountView {
        uint256 notes;
        uint256 pendingCoupon;
        uint256 claimedCoupons;
        uint256 redeemableValue;
        bool verified;
        bool frozen;
    }

    // ----------------------------------------------------------------- state

    bool private _initialized;
    bool private _forcing;
    string private _noteName;
    string private _noteSymbol;

    IERC20 public usdc;
    TokenisedMMF public fund;
    IdentityRegistry public registry;
    FloodOracle public oracle;
    address public platformTreasury;
    address public factory;

    string public peril;
    Phase public phase;

    uint128 public targetSize;
    uint128 public minSubscription;
    uint128 public principal;
    uint128 public totalPaidOut;

    uint64 public termSeconds;
    uint64 public riskStart;
    uint64 public riskEnd;
    uint64 public disputeWindow;
    uint16 public bufferBps;
    uint16 public servicingFeeBps;

    uint256 public bufferBalance; // stablecoin kept for instant payouts
    uint256 public fundShares; // tokenised MMF shares held as collateral
    uint256 public couponReserve; // stablecoin owed to holders as unclaimed coupons

    uint256 public accCouponPerNote;
    mapping(address => uint256) private _couponDebt;
    mapping(address => uint256) private _couponOwed;
    mapping(address => uint256) public claimedCoupons;

    uint256 public totalPremiums;
    uint256 public totalFees;
    uint256 public totalCollateralYield;
    uint256 public totalCouponsDistributed;

    uint256 public redemptionPool;
    uint256 public supplyAtMaturity;
    uint256 public maturityRequestId;
    bool public maturityQueued;

    Location[] private _locations;
    mapping(uint256 => Tier[]) private _tiers;
    mapping(uint256 => District[]) private _districts;
    mapping(uint256 => PendingTrigger) private _pending;
    PayoutRequest[] private _payoutRequests;

    mapping(address => bool) public frozen;

    // ---------------------------------------------------------------- events

    event ProgrammeInitialised(string name, string symbol, uint256 targetSize, uint256 locations);
    event Subscribed(address indexed investor, uint256 amount);
    event SubscriptionClosed(
        uint256 principal, uint256 buffer, uint256 invested, uint256 fundShares, uint64 riskStart, uint64 riskEnd
    );
    event PremiumPaid(uint8 indexed locationId, address indexed payer, uint256 amount, uint256 fee, uint256 toHolders);
    event CollateralYieldDistributed(uint256 amount);
    event CouponClaimed(address indexed holder, uint256 amount);
    event TriggerProposed(
        uint8 indexed locationId,
        uint8 tierIndex,
        uint16 targetBps,
        uint32 rainfallMmX10,
        uint32 riverLevelCm,
        uint64 observedAt,
        uint8 sources,
        uint64 executableAt
    );
    event TriggerDisputed(uint8 indexed locationId, address indexed guardian, string reason);
    event PayoutExecuted(
        uint8 indexed locationId,
        address indexed cedent,
        uint16 cumulativeBps,
        uint256 amount,
        uint256 paidInstantly,
        uint256 queued,
        uint256 payoutRequestId
    );
    event RecoveryAllocation(uint8 indexed locationId, uint8 districtIndex, string district, uint256 amount);
    event PayoutSettled(uint256 indexed payoutRequestId, uint8 indexed locationId, address indexed cedent, uint256 amount);
    event AllocationPlanUpdated(uint8 indexed locationId, address indexed by, uint256 districts);
    event AddressFrozen(address indexed account, bool frozen, address indexed agent);
    event ForcedTransfer(address indexed from, address indexed to, uint256 amount, address indexed agent);
    event MaturityStarted(uint256 fundSharesRedeemed, uint256 fundRequestId);
    event ProgrammeMatured(uint256 redemptionPool, uint256 supply);
    event NotesRedeemed(address indexed holder, uint256 notes, uint256 amount);

    // ---------------------------------------------------------------- errors

    error AlreadyInitialised();
    error InvalidConfig();
    error WrongPhase(Phase current);
    error NotVerified(address account);
    error AccountFrozen(address account);
    error BelowMinimum(uint256 minimum);
    error ExceedsTarget(uint256 remaining);
    error UnknownLocation();
    error OracleNotReady();
    error ObservationOutsideRiskPeriod();
    error RiskPeriodEnded();
    error NoNewTrigger();
    error NoPendingTrigger();
    error DisputeWindowOpen(uint64 executableAt);
    error DisputeWindowClosed();
    error NotCedentOrManager();
    error AlreadySettled();
    error TriggerPending(uint8 locationId);
    error RiskPeriodNotOver();
    error NothingToClaim();
    error ZeroAmount();

    // ----------------------------------------------------------- initialise

    /// @dev Locks the implementation; clones are set up through initialize().
    constructor() ERC20("", "") {
        _initialized = true;
    }

    function initialize(
        ProgrammeConfig calldata cfg,
        Infrastructure calldata infra,
        LocationConfig[] calldata locations
    ) external {
        if (_initialized) revert AlreadyInitialised();
        _initialized = true;

        uint256 n = locations.length;
        if (n == 0 || n > MAX_LOCATIONS) revert InvalidConfig();
        if (cfg.targetSize == 0 || cfg.termSeconds == 0) revert InvalidConfig();
        if (cfg.bufferBps > BPS || cfg.servicingFeeBps > BPS) revert InvalidConfig();
        if (cfg.admin == address(0) || infra.platformTreasury == address(0)) revert InvalidConfig();

        _noteName = cfg.name;
        _noteSymbol = cfg.symbol;
        peril = cfg.peril;
        targetSize = cfg.targetSize;
        minSubscription = cfg.minSubscription;
        termSeconds = cfg.termSeconds;
        disputeWindow = cfg.disputeWindow;
        bufferBps = cfg.bufferBps;
        servicingFeeBps = cfg.servicingFeeBps;

        usdc = IERC20(infra.usdc);
        fund = TokenisedMMF(infra.fund);
        registry = IdentityRegistry(infra.registry);
        oracle = FloodOracle(infra.oracle);
        platformTreasury = infra.platformTreasury;
        factory = msg.sender;

        uint256 totalSublimit;
        for (uint256 i; i < n; ++i) {
            LocationConfig calldata lc = locations[i];
            if (lc.cedent == address(0) || lc.tiers.length == 0 || lc.tiers.length > MAX_TIERS) {
                revert InvalidConfig();
            }
            totalSublimit += lc.sublimitBps;
            _locations.push(
                Location({
                    name: lc.name,
                    country: lc.country,
                    stationId: lc.stationId,
                    cedent: lc.cedent,
                    cedentName: lc.cedentName,
                    sublimitBps: lc.sublimitBps,
                    premiumRateBps: lc.premiumRateBps,
                    paidBps: 0,
                    premiumsPaid: 0,
                    totalPaidOut: 0
                })
            );
            uint16 lastBps;
            for (uint256 t; t < lc.tiers.length; ++t) {
                Tier calldata tier = lc.tiers[t];
                // tiers must escalate and the top tier cannot pay more than 100%
                if (tier.payoutBps <= lastBps || tier.payoutBps > BPS) revert InvalidConfig();
                lastBps = tier.payoutBps;
                _tiers[i].push(tier);
            }
        }
        if (totalSublimit != BPS) revert InvalidConfig();

        _grantRole(DEFAULT_ADMIN_ROLE, cfg.admin);
        _grantRole(MANAGER_ROLE, cfg.admin);
        _grantRole(AGENT_ROLE, cfg.admin);
        _grantRole(GUARDIAN_ROLE, cfg.admin);

        emit ProgrammeInitialised(cfg.name, cfg.symbol, cfg.targetSize, n);
    }

    function name() public view override returns (string memory) {
        return _noteName;
    }

    function symbol() public view override returns (string memory) {
        return _noteSymbol;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // ---------------------------------------------------------- subscription

    /// @notice Buy notes 1:1 with tUSDC during the subscription period. Eligible investors only.
    function subscribe(uint256 amount) external nonReentrant whenNotPaused {
        if (phase != Phase.Subscription) revert WrongPhase(phase);
        if (amount == 0) revert ZeroAmount();
        if (!registry.isVerified(msg.sender)) revert NotVerified(msg.sender);
        uint256 remaining = targetSize - totalSupply();
        if (amount > remaining) revert ExceedsTarget(remaining);
        if (amount < minSubscription && amount != remaining) revert BelowMinimum(minSubscription);

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, amount);
        emit Subscribed(msg.sender, amount);
    }

    /// @notice Close the book, lock principal into the collateral vault and start the risk period.
    function closeSubscription() external onlyRole(MANAGER_ROLE) nonReentrant {
        if (phase != Phase.Subscription) revert WrongPhase(phase);
        uint256 raised = totalSupply();
        if (raised == 0) revert ZeroAmount();

        principal = uint128(raised);
        uint256 buffer = (raised * bufferBps) / BPS;
        uint256 invested = raised - buffer;
        bufferBalance = buffer;

        uint256 shares;
        if (invested > 0) {
            usdc.forceApprove(address(fund), invested);
            shares = fund.deposit(invested, address(this));
            fundShares = shares;
        }

        riskStart = uint64(block.timestamp);
        riskEnd = uint64(block.timestamp + termSeconds);
        phase = Phase.Active;
        emit SubscriptionClosed(raised, buffer, invested, shares, riskStart, riskEnd);
    }

    // ------------------------------------------------------------- coupons

    /// @notice Pay premium for a location's cover. Anyone may pay on the cedent's behalf.
    ///         Parapet's servicing fee is deducted; the rest becomes coupon for note holders.
    function payPremium(uint8 locationId, uint256 amount) external nonReentrant whenNotPaused {
        if (phase != Phase.Active) revert WrongPhase(phase);
        if (locationId >= _locations.length) revert UnknownLocation();
        if (amount == 0) revert ZeroAmount();

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 fee = (amount * servicingFeeBps) / BPS;
        if (fee > 0) usdc.safeTransfer(platformTreasury, fee);
        uint256 toHolders = amount - fee;

        _locations[locationId].premiumsPaid += uint128(amount);
        totalPremiums += amount;
        totalFees += fee;
        _distributeCoupon(toHolders);
        emit PremiumPaid(locationId, msg.sender, amount, fee, toHolders);
    }

    /// @notice Sweep collateral yield above remaining principal out of the fund and distribute it
    ///         as coupon. Uses the fund's instant liquidity facility (capped per call).
    function distributeCollateralYield() external nonReentrant returns (uint256 distributed) {
        if (phase != Phase.Active) revert WrongPhase(phase);
        uint256 excess = excessCollateral();
        uint256 limit = fund.instantLiquidityLimit();
        if (excess > limit) excess = limit;
        uint256 shares = fund.previewDeposit(excess); // round down: never dip below principal
        if (shares > fundShares) shares = fundShares;
        if (shares == 0) revert NothingToClaim();
        fundShares -= shares;
        distributed = fund.redeemInstant(shares, address(this));
        totalCollateralYield += distributed;
        _distributeCoupon(distributed);
        emit CollateralYieldDistributed(distributed);
    }

    function claimCoupon() external nonReentrant returns (uint256 amount) {
        _accrueAccount(msg.sender);
        _resetDebt(msg.sender);
        amount = _couponOwed[msg.sender];
        if (amount == 0) revert NothingToClaim();
        _couponOwed[msg.sender] = 0;
        couponReserve -= amount;
        claimedCoupons[msg.sender] += amount;
        usdc.safeTransfer(msg.sender, amount);
        emit CouponClaimed(msg.sender, amount);
    }

    function pendingCoupon(address account) public view returns (uint256) {
        uint256 accrued = (balanceOf(account) * accCouponPerNote) / ACC;
        uint256 debt = _couponDebt[account];
        return _couponOwed[account] + (accrued > debt ? accrued - debt : 0);
    }

    function _distributeCoupon(uint256 amount) internal {
        uint256 supply = totalSupply();
        if (amount == 0 || supply == 0) return;
        accCouponPerNote += (amount * ACC) / supply;
        couponReserve += amount;
        totalCouponsDistributed += amount;
    }

    function _accrueAccount(address account) internal {
        if (account == address(0)) return;
        uint256 accrued = (balanceOf(account) * accCouponPerNote) / ACC;
        uint256 debt = _couponDebt[account];
        if (accrued > debt) _couponOwed[account] += accrued - debt;
    }

    function _resetDebt(address account) internal {
        if (account == address(0)) return;
        _couponDebt[account] = (balanceOf(account) * accCouponPerNote) / ACC;
    }

    // ------------------------------------------------------------- triggers

    /// @notice Anyone can check a location against the oracle. If a higher tier is met, a payout
    ///         is proposed and becomes executable after the dispute window.
    function checkTrigger(uint8 locationId) external whenNotPaused {
        if (phase != Phase.Active) revert WrongPhase(phase);
        if (locationId >= _locations.length) revert UnknownLocation();
        if (block.timestamp > riskEnd) revert RiskPeriodEnded();

        Location storage loc = _locations[locationId];
        FloodOracle.Consensus memory c = oracle.consensus(loc.stationId);
        if (!c.ok) revert OracleNotReady();
        if (c.observedAt < riskStart) revert ObservationOutsideRiskPeriod();

        (bool met, uint8 tierIndex, uint16 targetBps) = _highestTier(locationId, c.rainfallMmX10, c.riverLevelCm);
        PendingTrigger storage p = _pending[locationId];
        uint16 floorBps = p.active ? p.targetBps : loc.paidBps;
        if (!met || targetBps <= floorBps) revert NoNewTrigger();

        uint64 executableAt = uint64(block.timestamp + disputeWindow);
        _pending[locationId] = PendingTrigger({
            active: true,
            tierIndex: tierIndex,
            targetBps: targetBps,
            proposedAt: uint64(block.timestamp),
            executableAt: executableAt,
            rainfallMmX10: c.rainfallMmX10,
            riverLevelCm: c.riverLevelCm,
            observedAt: c.observedAt,
            sources: c.sources
        });
        emit TriggerProposed(
            locationId, tierIndex, targetBps, c.rainfallMmX10, c.riverLevelCm, c.observedAt, c.sources, executableAt
        );
    }

    /// @notice Independent guardian challenges a proposed trigger (e.g. a faulty gauge) in time.
    function disputeTrigger(uint8 locationId, string calldata reason) external onlyRole(GUARDIAN_ROLE) {
        PendingTrigger storage p = _pending[locationId];
        if (!p.active) revert NoPendingTrigger();
        if (block.timestamp >= p.executableAt) revert DisputeWindowClosed();
        delete _pending[locationId];
        emit TriggerDisputed(locationId, msg.sender, reason);
    }

    /// @notice Execute an undisputed trigger. Callable by anyone and deliberately not pausable,
    ///         so a confirmed payout cannot be withheld.
    function executePayout(uint8 locationId) external nonReentrant {
        if (locationId >= _locations.length) revert UnknownLocation();
        PendingTrigger memory p = _pending[locationId];
        if (!p.active) revert NoPendingTrigger();
        if (block.timestamp < p.executableAt) revert DisputeWindowOpen(p.executableAt);
        delete _pending[locationId];

        Location storage loc = _locations[locationId];
        uint256 amount = (locationLimit(locationId) * (p.targetBps - loc.paidBps)) / BPS;
        loc.paidBps = p.targetBps;
        loc.totalPaidOut += uint128(amount);
        totalPaidOut += uint128(amount);

        // Tranche 1: the stablecoin buffer pays at once.
        uint256 instant = amount <= bufferBalance ? amount : bufferBalance;
        bufferBalance -= instant;
        if (instant > 0) usdc.safeTransfer(loc.cedent, instant);

        // Tranche 2: redeem fund shares, instantly if small enough, otherwise queued.
        uint256 rest = amount - instant;
        uint256 requestId = type(uint256).max;
        if (rest > 0) {
            uint256 shares = fund.previewWithdraw(rest);
            if (shares > fundShares) shares = fundShares;
            fundShares -= shares;
            if (fund.previewRedeem(shares) <= fund.instantLiquidityLimit()) {
                uint256 received = fund.redeemInstant(shares, address(this));
                uint256 pay = received < rest ? received : rest;
                usdc.safeTransfer(loc.cedent, pay);
                if (received > pay) bufferBalance += received - pay;
                instant += pay;
                rest = 0;
            } else {
                uint256 fundRequestId = fund.requestRedeem(shares, address(this));
                requestId = _payoutRequests.length;
                _payoutRequests.push(
                    PayoutRequest({
                        locationId: locationId,
                        amount: uint128(rest),
                        fundRequestId: fundRequestId,
                        requestedAt: uint64(block.timestamp),
                        settled: false
                    })
                );
            }
        }

        _recordAllocations(locationId, amount);
        emit PayoutExecuted(locationId, loc.cedent, p.targetBps, amount, instant, rest, requestId);
    }

    /// @notice Complete a queued payout once the fund redemption has settled. Callable by anyone.
    function settlePayout(uint256 payoutRequestId) external nonReentrant {
        PayoutRequest storage r = _payoutRequests[payoutRequestId];
        if (r.settled) revert AlreadySettled();
        r.settled = true;
        uint256 received = fund.claimRedeem(r.fundRequestId);
        uint256 pay = received < r.amount ? received : r.amount;
        address cedent = _locations[r.locationId].cedent;
        usdc.safeTransfer(cedent, pay);
        if (received > pay) bufferBalance += received - pay;
        emit PayoutSettled(payoutRequestId, r.locationId, cedent, pay);
    }

    function _highestTier(uint256 locationId, uint32 rain, uint32 level)
        internal
        view
        returns (bool met, uint8 tierIndex, uint16 bps)
    {
        Tier[] storage tiers = _tiers[locationId];
        for (uint256 i; i < tiers.length; ++i) {
            if (rain >= tiers[i].rainfallMmX10 && level >= tiers[i].riverLevelCm && tiers[i].payoutBps > bps) {
                met = true;
                tierIndex = uint8(i);
                bps = tiers[i].payoutBps;
            }
        }
    }

    function _recordAllocations(uint8 locationId, uint256 amount) internal {
        District[] storage d = _districts[locationId];
        for (uint256 i; i < d.length; ++i) {
            emit RecoveryAllocation(locationId, uint8(i), d[i].name, (amount * d[i].shareBps) / BPS);
        }
    }

    /// @notice The insurer's pre-agreed split of any payout across its districts. Recorded
    ///         on-chain for transparency; the insurer distributes the funds itself.
    function setAllocationPlan(uint8 locationId, string[] calldata names, uint16[] calldata sharesBps) external {
        if (locationId >= _locations.length) revert UnknownLocation();
        if (msg.sender != _locations[locationId].cedent && !hasRole(MANAGER_ROLE, msg.sender)) {
            revert NotCedentOrManager();
        }
        if (_pending[locationId].active) revert TriggerPending(locationId);
        if (names.length != sharesBps.length || names.length > MAX_DISTRICTS) revert InvalidConfig();
        uint256 total;
        delete _districts[locationId];
        for (uint256 i; i < names.length; ++i) {
            total += sharesBps[i];
            _districts[locationId].push(District({name: names[i], shareBps: sharesBps[i]}));
        }
        if (names.length > 0 && total != BPS) revert InvalidConfig();
        emit AllocationPlanUpdated(locationId, msg.sender, names.length);
    }

    // ------------------------------------------------------------- maturity

    /// @notice After the risk period (or once every location is fully paid), redeem the remaining
    ///         collateral from the fund so holders can be repaid.
    function beginMaturity() external nonReentrant {
        if (phase != Phase.Active) revert WrongPhase(phase);
        if (block.timestamp <= riskEnd && totalPaidOut < principal) revert RiskPeriodNotOver();
        for (uint256 i; i < _locations.length; ++i) {
            if (_pending[i].active) revert TriggerPending(uint8(i));
        }
        phase = Phase.Maturing;
        uint256 shares = fundShares;
        uint256 requestId;
        if (shares > 0) {
            fundShares = 0;
            requestId = fund.requestRedeem(shares, address(this));
            maturityRequestId = requestId;
            maturityQueued = true;
        }
        emit MaturityStarted(shares, requestId);
    }

    function finaliseMaturity() external nonReentrant {
        if (phase != Phase.Maturing) revert WrongPhase(phase);
        if (maturityQueued) {
            maturityQueued = false;
            bufferBalance += fund.claimRedeem(maturityRequestId);
        }
        redemptionPool = bufferBalance;
        bufferBalance = 0;
        supplyAtMaturity = totalSupply();
        phase = Phase.Matured;
        emit ProgrammeMatured(redemptionPool, supplyAtMaturity);
    }

    /// @notice Burn notes for their share of the remaining collateral (principal minus payouts,
    ///         plus any undistributed collateral yield).
    function redeem(uint256 notes) external nonReentrant returns (uint256 amount) {
        if (phase != Phase.Matured) revert WrongPhase(phase);
        if (notes == 0) revert ZeroAmount();
        if (frozen[msg.sender]) revert AccountFrozen(msg.sender);
        amount = Math.mulDiv(notes, redemptionPool, supplyAtMaturity);
        _burn(msg.sender, notes);
        usdc.safeTransfer(msg.sender, amount);
        emit NotesRedeemed(msg.sender, notes, amount);
    }

    // ----------------------------------------------------------- compliance

    function setFrozen(address account, bool isFrozen) external onlyRole(AGENT_ROLE) {
        frozen[account] = isFrozen;
        emit AddressFrozen(account, isFrozen, msg.sender);
    }

    /// @notice Transfer agent recovery tool (lost keys, court order). Recipient must be eligible.
    function forcedTransfer(address from, address to, uint256 amount) external onlyRole(AGENT_ROLE) {
        _forcing = true;
        _transfer(from, to, amount);
        _forcing = false;
        emit ForcedTransfer(from, to, amount, msg.sender);
    }

    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice ERC-3643 / ERC-1404-style pre-check. 0 = allowed, 1 = programme paused,
    ///         2 = sender frozen, 3 = recipient frozen, 4 = recipient not an eligible verified
    ///         investor, 5 = insufficient balance.
    function canTransfer(address from, address to, uint256 amount) external view returns (uint8) {
        if (paused()) return 1;
        if (frozen[from]) return 2;
        if (frozen[to]) return 3;
        if (!registry.isVerified(to)) return 4;
        if (balanceOf(from) < amount) return 5;
        return 0;
    }

    /// @dev Every mint, burn and transfer passes through here: settle coupons, then apply the
    ///      ERC-3643-style eligibility rules.
    function _update(address from, address to, uint256 value) internal override {
        if (to != address(0)) {
            if (!registry.isVerified(to)) revert NotVerified(to);
            if (from != address(0) && !_forcing) {
                if (paused()) revert EnforcedPause();
                if (frozen[from]) revert AccountFrozen(from);
                if (frozen[to]) revert AccountFrozen(to);
            }
        }
        _accrueAccount(from);
        _accrueAccount(to);
        super._update(from, to, value);
        _resetDebt(from);
        _resetDebt(to);
    }

    // ---------------------------------------------------------------- views

    function locationLimit(uint256 locationId) public view returns (uint256) {
        uint256 base = principal > 0 ? principal : targetSize;
        return (base * _locations[locationId].sublimitBps) / BPS;
    }

    function remainingPrincipal() public view returns (uint256) {
        return principal - totalPaidOut;
    }

    function fundValue() public view returns (uint256) {
        return fundShares == 0 ? 0 : fund.previewRedeem(fundShares);
    }

    /// @notice Collateral above what remaining principal requires: accrued fund yield.
    function excessCollateral() public view returns (uint256) {
        if (phase != Phase.Active) return 0;
        uint256 collateral = bufferBalance + fundValue();
        uint256 needed = remainingPrincipal();
        return collateral > needed ? collateral - needed : 0;
    }

    function programmeInfo() external view returns (ProgrammeView memory v) {
        v.name = _noteName;
        v.symbol = _noteSymbol;
        v.peril = peril;
        v.phase = phase;
        v.targetSize = targetSize;
        v.minSubscription = minSubscription;
        v.totalSubscribed = phase == Phase.Subscription ? totalSupply() : principal;
        v.principal = principal;
        v.totalPaidOut = totalPaidOut;
        v.remainingPrincipal = principal - totalPaidOut;
        v.riskStart = riskStart;
        v.riskEnd = riskEnd;
        v.termSeconds = termSeconds;
        v.disputeWindow = disputeWindow;
        v.bufferBps = bufferBps;
        v.servicingFeeBps = servicingFeeBps;
        v.bufferBalance = bufferBalance;
        v.fundShares = fundShares;
        v.fundValue = fundValue();
        v.excessCollateral = excessCollateral();
        v.couponReserve = couponReserve;
        v.totalPremiums = totalPremiums;
        v.totalFees = totalFees;
        v.totalCollateralYield = totalCollateralYield;
        v.totalCouponsDistributed = totalCouponsDistributed;
        v.redemptionPool = redemptionPool;
        v.supplyAtMaturity = supplyAtMaturity;
        v.locationCount = _locations.length;
        v.payoutRequestCount = _payoutRequests.length;
        v.paused = paused();
    }

    function getLocation(uint256 locationId) public view returns (LocationView memory v) {
        Location storage loc = _locations[locationId];
        v.location = loc;
        v.tiers = _tiers[locationId];
        v.districts = _districts[locationId];
        v.pending = _pending[locationId];
        v.limit = locationLimit(locationId);
        v.annualPremium = (v.limit * loc.premiumRateBps) / BPS;
    }

    function getPayoutRequests() external view returns (PayoutRequest[] memory) {
        return _payoutRequests;
    }

    function accountInfo(address account) external view returns (AccountView memory v) {
        v.notes = balanceOf(account);
        v.pendingCoupon = pendingCoupon(account);
        v.claimedCoupons = claimedCoupons[account];
        v.redeemableValue = phase == Phase.Matured && supplyAtMaturity > 0
            ? Math.mulDiv(v.notes, redemptionPool, supplyAtMaturity)
            : (principal == 0 ? v.notes : Math.mulDiv(v.notes, principal - totalPaidOut, principal));
        v.verified = registry.isVerified(account);
        v.frozen = frozen[account];
    }
}
