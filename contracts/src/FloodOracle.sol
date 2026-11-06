// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ParaCat Flood Data Oracle
/// @notice Brings independently measured hazard data on-chain for the parametric trigger.
///         Each monitored station (a river gauge and its catchment) receives readings from
///         several licensed data providers, e.g. a hydromet agency's gauge telemetry and a
///         satellite rainfall product. The trigger only ever sees a consensus value:
///         - at least `quorum` providers must have reported,
///         - each reading must be fresher than `maxAge`,
///         - the lower median of the readings is used, so one faulty or manipulated feed cannot
///           force a payout on its own.
/// @dev In production the provider feeds would be delivered through an oracle network such as
///      Chainlink (Functions / Data Streams) with signed data; the consensus rule stays the same.
contract FloodOracle is AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PROVIDER_ROLE = keccak256("PROVIDER_ROLE");
    uint256 public constant MAX_PROVIDERS = 7;

    struct Station {
        string name; // e.g. "Sto. Nino gauge"
        string river; // e.g. "Marikina River"
        string city; // e.g. "Metro Manila"
        bool active;
    }

    struct Observation {
        uint32 rainfallMmX10; // 24-hour accumulated rainfall, tenths of a millimetre
        uint32 riverLevelCm; // water level at the gauge, centimetres
        uint64 observedAt;
        uint64 submittedAt;
        string sourceRef; // provider's own reference, e.g. bulletin id or data hash
    }

    struct Consensus {
        bool ok;
        uint32 rainfallMmX10;
        uint32 riverLevelCm;
        uint64 observedAt; // oldest observation time used
        uint8 sources;
    }

    uint8 public quorum;
    uint64 public maxAge;

    mapping(bytes32 => Station) private _stations;
    bytes32[] private _stationIds;
    address[] private _providers;
    mapping(address => string) public providerName;
    mapping(bytes32 => mapping(address => Observation)) private _latest;

    event StationAdded(bytes32 indexed stationId, string name, string river, string city);
    event ProviderAdded(address indexed provider, string name);
    event ProviderRemoved(address indexed provider);
    event OracleConfigUpdated(uint8 quorum, uint64 maxAge);
    event ObservationSubmitted(
        bytes32 indexed stationId,
        address indexed provider,
        uint32 rainfallMmX10,
        uint32 riverLevelCm,
        uint64 observedAt,
        string sourceRef
    );

    error UnknownStation();
    error StaleObservation();
    error FutureObservation();
    error TooManyProviders();
    error InvalidConfig();

    constructor(address admin, uint8 quorum_, uint64 maxAge_) {
        if (quorum_ == 0 || maxAge_ == 0) revert InvalidConfig();
        quorum = quorum_;
        maxAge = maxAge_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    // ---------------------------------------------------------------- admin

    function addStation(bytes32 stationId, string calldata name, string calldata river, string calldata city)
        external
        onlyRole(OPERATOR_ROLE)
    {
        if (bytes(_stations[stationId].name).length == 0) _stationIds.push(stationId);
        _stations[stationId] = Station({name: name, river: river, city: city, active: true});
        emit StationAdded(stationId, name, river, city);
    }

    function addProvider(address provider, string calldata name) external onlyRole(OPERATOR_ROLE) {
        if (!hasRole(PROVIDER_ROLE, provider)) {
            if (_providers.length >= MAX_PROVIDERS) revert TooManyProviders();
            _providers.push(provider);
            _grantRole(PROVIDER_ROLE, provider);
        }
        providerName[provider] = name;
        emit ProviderAdded(provider, name);
    }

    function removeProvider(address provider) external onlyRole(OPERATOR_ROLE) {
        _revokeRole(PROVIDER_ROLE, provider);
        for (uint256 i; i < _providers.length; ++i) {
            if (_providers[i] == provider) {
                _providers[i] = _providers[_providers.length - 1];
                _providers.pop();
                break;
            }
        }
        emit ProviderRemoved(provider);
    }

    function setConfig(uint8 quorum_, uint64 maxAge_) external onlyRole(OPERATOR_ROLE) {
        if (quorum_ == 0 || maxAge_ == 0) revert InvalidConfig();
        quorum = quorum_;
        maxAge = maxAge_;
        emit OracleConfigUpdated(quorum_, maxAge_);
    }

    // ------------------------------------------------------------ reporting

    function submitObservation(
        bytes32 stationId,
        uint32 rainfallMmX10,
        uint32 riverLevelCm,
        uint64 observedAt,
        string calldata sourceRef
    ) external onlyRole(PROVIDER_ROLE) {
        if (!_stations[stationId].active) revert UnknownStation();
        if (observedAt > block.timestamp + 5 minutes) revert FutureObservation();
        if (observedAt + maxAge < block.timestamp) revert StaleObservation();
        _latest[stationId][msg.sender] = Observation({
            rainfallMmX10: rainfallMmX10,
            riverLevelCm: riverLevelCm,
            observedAt: observedAt,
            submittedAt: uint64(block.timestamp),
            sourceRef: sourceRef
        });
        emit ObservationSubmitted(stationId, msg.sender, rainfallMmX10, riverLevelCm, observedAt, sourceRef);
    }

    // ------------------------------------------------------------ consensus

    /// @notice Consensus reading for a station, or ok = false if quorum is not met.
    function consensus(bytes32 stationId) external view returns (Consensus memory c) {
        uint256 n = _providers.length;
        uint32[] memory rain = new uint32[](n);
        uint32[] memory level = new uint32[](n);
        uint64 oldest = type(uint64).max;
        uint256 count;
        for (uint256 i; i < n; ++i) {
            Observation storage o = _latest[stationId][_providers[i]];
            if (o.observedAt == 0 || o.observedAt + maxAge < block.timestamp) continue;
            rain[count] = o.rainfallMmX10;
            level[count] = o.riverLevelCm;
            if (o.observedAt < oldest) oldest = o.observedAt;
            ++count;
        }
        if (count == 0 || count < quorum) return c;
        c.ok = true;
        c.sources = uint8(count);
        c.rainfallMmX10 = _lowerMedian(rain, count);
        c.riverLevelCm = _lowerMedian(level, count);
        c.observedAt = oldest;
    }

    function _lowerMedian(uint32[] memory values, uint256 count) internal pure returns (uint32) {
        for (uint256 i = 1; i < count; ++i) {
            uint32 key = values[i];
            uint256 j = i;
            while (j > 0 && values[j - 1] > key) {
                values[j] = values[j - 1];
                --j;
            }
            values[j] = key;
        }
        return values[(count - 1) / 2];
    }

    // ---------------------------------------------------------------- views

    function station(bytes32 stationId) external view returns (Station memory) {
        return _stations[stationId];
    }

    function getStationIds() external view returns (bytes32[] memory) {
        return _stationIds;
    }

    function getProviders() external view returns (address[] memory) {
        return _providers;
    }

    /// @notice Latest reading from every provider for a station (for dashboards and audit).
    function getReadings(bytes32 stationId)
        external
        view
        returns (address[] memory providers, Observation[] memory observations)
    {
        providers = _providers;
        observations = new Observation[](providers.length);
        for (uint256 i; i < providers.length; ++i) {
            observations[i] = _latest[stationId][providers[i]];
        }
    }
}
