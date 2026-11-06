// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IMintableUSD is IERC20 {
    function mint(address to, uint256 amount) external;
}

/// @title Tokenised Government Money-Market Fund (demo)
/// @notice Stands in for a tokenised Treasury/government MMF share class (the BUIDL / BENJI /
///         tokenised-SGS family). Each share's NAV accrues at a configurable yield, so collateral
///         parked here keeps earning while it secures catastrophe risk.
///
///         Two redemption routes mirror how real tokenised funds settle:
///         - redeemInstant: small redemptions served by an instant liquidity facility (capped)
///         - requestRedeem / claimRedeem: larger redemptions settle after a delay (T+1 in
///           production), inspired by the ERC-7540 asynchronous vault standard.
///
/// @dev Demo-only features: `timeAcceleration` speeds up yield (1440 = one minute of wall-clock
///      time accrues one day of interest) and the fund mints tUSDC to realise its T-bill income.
contract TokenisedMMF is ERC20, AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant FUND_ADMIN_ROLE = keccak256("FUND_ADMIN_ROLE");
    uint256 private constant NAV_SCALE = 1e18;
    uint256 private constant YEAR = 365 days;

    struct RedemptionRequest {
        address owner;
        address receiver;
        uint128 assets;
        uint64 requestedAt;
        uint64 claimableAt;
        bool claimed;
    }

    IMintableUSD public immutable asset;

    uint256 public apyBps; // e.g. 450 = 4.50% a year
    uint256 public timeAcceleration; // 1 = real time
    uint256 public instantLiquidityLimit; // max assets per instant redemption
    uint256 public settlementDelay; // seconds until an async redemption can be claimed

    uint256 private _navSnapshot; // NAV per share, 1e18 = 1.00 tUSDC
    uint256 private _lastAccrual;

    RedemptionRequest[] private _requests;

    event Deposited(address indexed sender, address indexed receiver, uint256 assets, uint256 shares);
    event InstantRedemption(address indexed owner, address indexed receiver, uint256 shares, uint256 assets);
    event RedemptionRequested(
        uint256 indexed requestId, address indexed owner, uint256 shares, uint256 assets, uint64 claimableAt
    );
    event RedemptionClaimed(uint256 indexed requestId, address indexed receiver, uint256 assets);
    event FundParametersUpdated(uint256 apyBps, uint256 timeAcceleration, uint256 instantLimit, uint256 delay);

    error ZeroAmount();
    error AboveInstantLimit(uint256 assets, uint256 limit);
    error NotClaimable(uint64 claimableAt);
    error AlreadyClaimed();
    error NotRequestOwner();

    constructor(
        address admin,
        IMintableUSD asset_,
        uint256 apyBps_,
        uint256 timeAcceleration_,
        uint256 instantLiquidityLimit_,
        uint256 settlementDelay_
    ) ERC20("Tokenised Government MMF (demo)", "tMMF") {
        asset = asset_;
        apyBps = apyBps_;
        timeAcceleration = timeAcceleration_ == 0 ? 1 : timeAcceleration_;
        instantLiquidityLimit = instantLiquidityLimit_;
        settlementDelay = settlementDelay_;
        _navSnapshot = NAV_SCALE;
        _lastAccrual = block.timestamp;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(FUND_ADMIN_ROLE, admin);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // ------------------------------------------------------------------ NAV

    /// @notice Current NAV per share (1e18 = 1.00 tUSDC).
    function navPerShare() public view returns (uint256) {
        uint256 elapsed = (block.timestamp - _lastAccrual) * timeAcceleration;
        return _navSnapshot + Math.mulDiv(_navSnapshot, apyBps * elapsed, 10_000 * YEAR);
    }

    function totalAssets() external view returns (uint256) {
        return Math.mulDiv(totalSupply(), navPerShare(), NAV_SCALE);
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        return Math.mulDiv(shares, navPerShare(), NAV_SCALE);
    }

    /// @notice Shares needed to withdraw `assets` (rounded up so the caller never gets short-changed).
    function previewWithdraw(uint256 assets) public view returns (uint256) {
        return Math.mulDiv(assets, NAV_SCALE, navPerShare(), Math.Rounding.Ceil);
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        return Math.mulDiv(assets, NAV_SCALE, navPerShare());
    }

    function _accrue() internal {
        _navSnapshot = navPerShare();
        _lastAccrual = block.timestamp;
    }

    // ------------------------------------------------------------- deposits

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        _accrue();
        shares = previewDeposit(assets);
        IERC20(address(asset)).safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);
        emit Deposited(msg.sender, receiver, assets, shares);
    }

    // ---------------------------------------------------------- redemptions

    /// @notice Redeem immediately through the fund's instant liquidity facility (capped).
    function redeemInstant(uint256 shares, address receiver) external returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        _accrue();
        assets = previewRedeem(shares);
        if (assets > instantLiquidityLimit) revert AboveInstantLimit(assets, instantLiquidityLimit);
        _burn(msg.sender, shares);
        _payOut(receiver, assets);
        emit InstantRedemption(msg.sender, receiver, shares, assets);
    }

    /// @notice Queue a redemption at today's NAV; it can be claimed after `settlementDelay`.
    function requestRedeem(uint256 shares, address receiver) external returns (uint256 requestId) {
        if (shares == 0) revert ZeroAmount();
        _accrue();
        uint256 assets = previewRedeem(shares);
        _burn(msg.sender, shares);
        uint64 claimableAt = uint64(block.timestamp + settlementDelay);
        requestId = _requests.length;
        _requests.push(
            RedemptionRequest({
                owner: msg.sender,
                receiver: receiver,
                assets: uint128(assets),
                requestedAt: uint64(block.timestamp),
                claimableAt: claimableAt,
                claimed: false
            })
        );
        emit RedemptionRequested(requestId, msg.sender, shares, assets, claimableAt);
    }

    /// @notice Settle a queued redemption. Only the account that requested it can claim.
    function claimRedeem(uint256 requestId) external returns (uint256 assets) {
        RedemptionRequest storage r = _requests[requestId];
        if (r.owner != msg.sender) revert NotRequestOwner();
        if (r.claimed) revert AlreadyClaimed();
        if (block.timestamp < r.claimableAt) revert NotClaimable(r.claimableAt);
        r.claimed = true;
        assets = r.assets;
        _payOut(r.receiver, assets);
        emit RedemptionClaimed(requestId, r.receiver, assets);
    }

    function getRequest(uint256 requestId) external view returns (RedemptionRequest memory) {
        return _requests[requestId];
    }

    function requestCount() external view returns (uint256) {
        return _requests.length;
    }

    /// @dev If the fund's cash is short of what it owes, it "sells T-bills": the demo mints the
    ///      income that the underlying government securities would have earned.
    function _payOut(address receiver, uint256 assets) internal {
        uint256 cash = asset.balanceOf(address(this));
        if (cash < assets) asset.mint(address(this), assets - cash);
        IERC20(address(asset)).safeTransfer(receiver, assets);
    }

    // ---------------------------------------------------------------- admin

    function setParameters(
        uint256 apyBps_,
        uint256 timeAcceleration_,
        uint256 instantLiquidityLimit_,
        uint256 settlementDelay_
    ) external onlyRole(FUND_ADMIN_ROLE) {
        _accrue();
        apyBps = apyBps_;
        timeAcceleration = timeAcceleration_ == 0 ? 1 : timeAcceleration_;
        instantLiquidityLimit = instantLiquidityLimit_;
        settlementDelay = settlementDelay_;
        emit FundParametersUpdated(apyBps_, timeAcceleration, instantLiquidityLimit_, settlementDelay_);
    }
}
