// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

import {ParaCatProgramme} from "./ParaCatProgramme.sol";

/// @title ParaCat Issuance Platform
/// @notice Issues new Recovery Notes programmes from one audited template. Each programme is an
///         EIP-1167 minimal clone of the same implementation: the legal and technical structure is
///         engineered once, and each new deal only supplies its parameters (locations, triggers,
///         size, premium). That is what makes a US$20m regional programme economic.
///
///         Business model: Parapet charges an issuance fee on each programme's target size here,
///         and a servicing fee on every premium payment inside the programme.
contract ParaCatFactory is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    uint16 public constant BPS = 10_000;

    address public implementation;
    address public usdc;
    address public fund;
    address public registry;
    address public oracle;
    address public platformTreasury;
    uint16 public issuanceFeeBps;

    address[] private _programmes;

    event ProgrammeCreated(
        address indexed programme, string name, string symbol, uint256 targetSize, uint256 issuanceFee, address issuer
    );
    event ImplementationUpdated(address implementation);
    event FeesUpdated(uint16 issuanceFeeBps, address platformTreasury);

    error InvalidConfig();

    constructor(
        address admin,
        address implementation_,
        address usdc_,
        address fund_,
        address registry_,
        address oracle_,
        address platformTreasury_,
        uint16 issuanceFeeBps_
    ) {
        if (implementation_ == address(0) || platformTreasury_ == address(0) || issuanceFeeBps_ > BPS) {
            revert InvalidConfig();
        }
        implementation = implementation_;
        usdc = usdc_;
        fund = fund_;
        registry = registry_;
        oracle = oracle_;
        platformTreasury = platformTreasury_;
        issuanceFeeBps = issuanceFeeBps_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ISSUER_ROLE, admin);
    }

    /// @notice Issue a new programme. The caller pays the issuance fee in tUSDC.
    function createProgramme(
        ParaCatProgramme.ProgrammeConfig calldata cfg,
        ParaCatProgramme.LocationConfig[] calldata locations
    ) external onlyRole(ISSUER_ROLE) returns (address programme) {
        uint256 fee = (uint256(cfg.targetSize) * issuanceFeeBps) / BPS;
        if (fee > 0) IERC20(usdc).safeTransferFrom(msg.sender, platformTreasury, fee);

        programme = Clones.clone(implementation);
        ParaCatProgramme(programme).initialize(
            cfg,
            ParaCatProgramme.Infrastructure({
                usdc: usdc,
                fund: fund,
                registry: registry,
                oracle: oracle,
                platformTreasury: platformTreasury
            }),
            locations
        );
        _programmes.push(programme);
        emit ProgrammeCreated(programme, cfg.name, cfg.symbol, cfg.targetSize, fee, msg.sender);
    }

    function issuanceFeeFor(uint256 targetSize) external view returns (uint256) {
        return (targetSize * issuanceFeeBps) / BPS;
    }

    function getProgrammes() external view returns (address[] memory) {
        return _programmes;
    }

    function programmeCount() external view returns (uint256) {
        return _programmes.length;
    }

    /// @notice Point future programmes at a new audited template version. Existing ones are unaffected.
    function setImplementation(address implementation_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (implementation_ == address(0)) revert InvalidConfig();
        implementation = implementation_;
        emit ImplementationUpdated(implementation_);
    }

    function setFees(uint16 issuanceFeeBps_, address platformTreasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (platformTreasury_ == address(0) || issuanceFeeBps_ > BPS) revert InvalidConfig();
        issuanceFeeBps = issuanceFeeBps_;
        platformTreasury = platformTreasury_;
        emit FeesUpdated(issuanceFeeBps_, platformTreasury_);
    }
}
