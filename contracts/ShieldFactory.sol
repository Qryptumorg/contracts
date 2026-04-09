// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./PersonalVault.sol";

contract ShieldFactory is Ownable, Pausable {
    using Clones for address;

    address public immutable vaultImplementation;
    mapping(address => address) private vaults;

    event VaultCreated(address indexed owner, address indexed vault);

    constructor() Ownable(msg.sender) {
        vaultImplementation = address(new PersonalVault());
    }

    function createVault(bytes32 passwordHash) external whenNotPaused returns (address vault) {
        require(vaults[msg.sender] == address(0), "Qrypt-Safe already exists for this wallet");

        vault = vaultImplementation.clone();
        PersonalVault(vault).initialize(msg.sender, passwordHash);
        vaults[msg.sender] = vault;

        emit VaultCreated(msg.sender, vault);
    }

    function hasVault(address wallet) external view returns (bool) {
        return vaults[wallet] != address(0);
    }

    function getVault(address wallet) external view returns (address) {
        return vaults[wallet];
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
