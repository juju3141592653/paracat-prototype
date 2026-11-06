// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title Test USD Coin (tUSDC)
/// @notice Demo stablecoin standing in for USDC / a tokenised deposit on testnets.
///         6 decimals like USDC. The public faucet exists for demos only.
/// @dev The tokenised MMF holds MINTER_ROLE so it can realise simulated T-bill income.
contract MockUSDC is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Maximum a wallet can draw from the faucet in one call.
    uint256 public constant FAUCET_MAX = 10_000_000e6;

    error FaucetLimit(uint256 max);

    constructor(address admin) ERC20("Test USD Coin", "tUSDC") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /// @notice Testnet faucet: mint up to 10m tUSDC to yourself.
    function faucet(uint256 amount) external {
        if (amount > FAUCET_MAX) revert FaucetLimit(FAUCET_MAX);
        _mint(msg.sender, amount);
    }
}
