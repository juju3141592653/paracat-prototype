// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ParaCat Identity Registry
/// @notice On-chain eligibility list for ParaCat notes, modelled on the ERC-3643 (T-REX)
///         identity registry used for permissioned security tokens and in Project Guardian pilots.
///         A wallet is eligible to hold notes only if a licensed onboarding agent has recorded:
///         completed KYC/AML, accredited/institutional investor status, an unexpired check and a
///         country that is not restricted.
/// @dev In production each wallet would point to an ONCHAINID contract holding signed claims
///      from the KYC provider, and no personal data would sit on-chain. The `displayName` field
///      is for the demo UI only.
contract IdentityRegistry is AccessControl {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    enum Category {
        None,
        Institution,
        FamilyOffice,
        AccreditedIndividual,
        Insurer,
        ServiceProvider
    }

    struct Identity {
        bool kyc;
        bool accredited;
        uint16 country; // ISO 3166-1 numeric, e.g. 702 = Singapore
        Category category;
        uint64 expiresAt;
        string displayName;
    }

    mapping(address => Identity) private _identities;
    mapping(uint16 => bool) public restrictedCountry;
    address[] private _wallets;
    mapping(address => bool) private _listed;

    event IdentityRegistered(
        address indexed wallet, uint16 country, Category category, bool accredited, uint64 expiresAt, string displayName
    );
    event IdentityRevoked(address indexed wallet);
    event CountryRestrictionSet(uint16 indexed country, bool restricted);

    error ZeroAddress();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(AGENT_ROLE, admin);
    }

    function registerIdentity(
        address wallet,
        uint16 country,
        Category category,
        bool accredited,
        uint64 expiresAt,
        string calldata displayName
    ) external onlyRole(AGENT_ROLE) {
        if (wallet == address(0)) revert ZeroAddress();
        _identities[wallet] = Identity({
            kyc: true,
            accredited: accredited,
            country: country,
            category: category,
            expiresAt: expiresAt,
            displayName: displayName
        });
        if (!_listed[wallet]) {
            _listed[wallet] = true;
            _wallets.push(wallet);
        }
        emit IdentityRegistered(wallet, country, category, accredited, expiresAt, displayName);
    }

    function revokeIdentity(address wallet) external onlyRole(AGENT_ROLE) {
        _identities[wallet].kyc = false;
        _identities[wallet].accredited = false;
        emit IdentityRevoked(wallet);
    }

    function setCountryRestriction(uint16 country, bool restricted) external onlyRole(AGENT_ROLE) {
        restrictedCountry[country] = restricted;
        emit CountryRestrictionSet(country, restricted);
    }

    /// @notice True if the wallet may hold and receive ParaCat notes.
    function isVerified(address wallet) public view returns (bool) {
        Identity storage id = _identities[wallet];
        return id.kyc && id.accredited && id.expiresAt >= block.timestamp && !restrictedCountry[id.country];
    }

    function identityOf(address wallet) external view returns (Identity memory) {
        return _identities[wallet];
    }

    function getWallets() external view returns (address[] memory) {
        return _wallets;
    }
}
