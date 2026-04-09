// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./PersonalQryptSafe.sol";

contract QryptSafe {
    using Clones for address;

    address public immutable vaultImplementation;
    mapping(address => address) private vaults;

    event VaultCreated(address indexed owner, address indexed vault);

    constructor() {
        vaultImplementation = address(new PersonalQryptSafe());
    }

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
