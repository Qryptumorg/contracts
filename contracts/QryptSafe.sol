// SPDX-License-Identifier: MIT
// Qryptum Protocol -- https://qryptum.org
pragma solidity 0.8.34;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./PersonalQryptSafe.sol";

contract QryptSafe {
    using Clones for address;

    bytes32 private constant _QRYPTUM_ID = keccak256("qryptum.protocol.mainnet");
    address public immutable vaultImplementation;
    mapping(address => address) private vaults;

    event VaultCreated(address indexed owner, address indexed vault);

    constructor() {
        vaultImplementation = address(new PersonalQryptSafe());
    }

    // initialChainHead = H100 of OTP chain, computed by frontend from vault proof
    function createVault(bytes32 initialChainHead) external returns (address vault) {
        require(vaults[msg.sender] == address(0), "Qrypt-Safe already exists for this wallet");
        require(initialChainHead != bytes32(0), "Invalid chain head");

        vault = vaultImplementation.clone();
        PersonalQryptSafe(vault).initialize(msg.sender, initialChainHead);
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
