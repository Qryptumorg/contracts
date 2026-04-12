// SPDX-License-Identifier: MIT
// Qryptum Protocol v4.0 -- https://qryptum.org
pragma solidity 0.8.34;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./PersonalQryptSafeV4.sol";

// V4: Custom errors (gas efficient vs require strings)
// V4: Vault metadata: createdAt block stored in factory mapping
// V4: Factory emits richer VaultCreated event with block number
// Critical bug remaining: no Railgun, no QryptAir offline voucher
// Fixed in V5: Railgun unshieldToRailgun + QryptAir EIP-712
contract QryptSafeV4 {
    using Clones for address;

    bytes32 private constant _QRYPTUM_SALT = keccak256("qryptum.v4.sepolia");
    address public immutable vaultImplementation;
    mapping(address => address) private vaults;
    mapping(address => uint256) public vaultCreatedAt;

    error VaultAlreadyExists();
    error ZeroAddress();

    event VaultCreated(address indexed owner, address indexed vault, uint256 createdAt);

    constructor() {
        vaultImplementation = address(new PersonalQryptSafeV4());
    }

    function createVault(bytes32 passwordHash) external returns (address vault) {
        if (vaults[msg.sender] != address(0)) revert VaultAlreadyExists();
        vault = vaultImplementation.clone();
        PersonalQryptSafeV4(vault).initialize(msg.sender, passwordHash);
        vaults[msg.sender] = vault;
        vaultCreatedAt[msg.sender] = block.number;
        emit VaultCreated(msg.sender, vault, block.number);
    }

    function hasVault(address wallet) external view returns (bool) { return vaults[wallet] != address(0); }
    function getVault(address wallet) external view returns (address) { return vaults[wallet]; }
}
