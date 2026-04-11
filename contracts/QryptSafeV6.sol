// SPDX-License-Identifier: MIT
// Qryptum Protocol v6.0 -- https://qryptum.org
pragma solidity 0.8.34;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./PersonalQryptSafeV6.sol";

contract QryptSafeV6 {
    using Clones for address;

    address public immutable vaultImplementation;
    mapping(address => address) private vaults;

    event VaultCreated(address indexed owner, address indexed vault);

    constructor() {
        vaultImplementation = address(new PersonalQryptSafeV6());
    }

    // initialChainHead = H100 of OTP chain, computed by frontend from vault proof
    function createVault(bytes32 initialChainHead) external returns (address vault) {
        require(vaults[msg.sender] == address(0), "Qrypt-Safe already exists for this wallet");
        require(initialChainHead != bytes32(0), "Invalid chain head");

        vault = vaultImplementation.clone();
        PersonalQryptSafeV6(vault).initialize(msg.sender, initialChainHead);
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
