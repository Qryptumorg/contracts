// SPDX-License-Identifier: MIT
// Qryptum Protocol v3.0 -- https://qryptum.org
pragma solidity 0.8.34;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./PersonalQryptSafeV3.sol";

// V3: Ownable fully removed (fix V2 admin key risk)
// V3: MINIMUM_SHIELD_AMOUNT is an immutable constant -- no admin can change it
// V3: Factory is fully permissionless from block zero
// Known bug remaining: passwordHash static string -- fixed in V4 with OTP chain
contract QryptSafeV3 {
    using Clones for address;

    bytes32 private constant _QRYPTUM_SALT = keccak256("qryptum.v3.sepolia");
    address public immutable vaultImplementation;
    uint256 public constant MINIMUM_SHIELD_AMOUNT = 1_000_000;
    mapping(address => address) private vaults;

    event VaultCreated(address indexed owner, address indexed vault, bytes32 passwordHash);

    constructor() {
        vaultImplementation = address(new PersonalQryptSafeV3());
    }

    function createVault(bytes32 passwordHash) external returns (address vault) {
        require(vaults[msg.sender] == address(0), "Vault already exists for this wallet");
        vault = vaultImplementation.clone();
        PersonalQryptSafeV3(vault).initialize(msg.sender, passwordHash);
        vaults[msg.sender] = vault;
        emit VaultCreated(msg.sender, vault, passwordHash);
    }

    function hasVault(address wallet) external view returns (bool) { return vaults[wallet] != address(0); }
    function getVault(address wallet) external view returns (address) { return vaults[wallet]; }
}
