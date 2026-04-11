// SPDX-License-Identifier: MIT
// Qryptum Protocol v5.0 -- https://qryptum.org
pragma solidity 0.8.34;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./PersonalQryptSafeV5.sol";

contract QryptSafe {
    using Clones for address;

    address public immutable vaultImplementation;
    mapping(address => address) private vaults;

    event VaultCreated(address indexed owner, address indexed vault);

    constructor() {
        vaultImplementation = address(new PersonalQryptSafe());
    }

    // passwordHash = keccak256(password) computed by frontend
    function createVault(bytes32 passwordHash) external returns (address vault) {
        require(vaults[msg.sender] == address(0), "Qrypt-Safe already exists for this wallet");

        vault = vaultImplementation.clone();
        PersonalQryptSafe(vault).initialize(msg.sender, passwordHash);
        vaults[msg.sender] = vault;

        emit VaultCreated(msg.sender, vault);
    }

    function hasVault(address wallet) external view returns (bool) {
        return vaults[wallet] != address(0);
    }

    function getVault(address wallet) external view returns (address) {
        return vaults[wallet];
    }
}
