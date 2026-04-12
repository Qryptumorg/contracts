// SPDX-License-Identifier: MIT
  // Qryptum Protocol v2.0 -- https://qryptum.org
  pragma solidity 0.8.34;

  import "@openzeppelin/contracts/proxy/Clones.sol";
  import "@openzeppelin/contracts/access/Ownable.sol";
  import "./PersonalQryptSafeV2.sol";

  // V2: Pausable removed (fix V1 centralization bug)
  // Ownable kept: admin can set protocol minimum shield amount
  // Critical bug remaining: passwordHash static, commit has no nonce binding
  // Fixed in V3: Ownable removed, ECDSA added
  contract QryptSafeV2 is Ownable {
      using Clones for address;

      bytes32 private constant _QRYPTUM_SALT = keccak256("qryptum.v2.sepolia");
      address public immutable vaultImplementation;
      uint256 public minShieldAmount = 1e6;
      mapping(address => address) private vaults;

      event VaultCreated(address indexed owner, address indexed vault);
      event MinShieldAmountUpdated(uint256 newMin);

      constructor() Ownable(msg.sender) {
          vaultImplementation = address(new PersonalQryptSafeV2());
      }

      function createVault(bytes32 passwordHash) external returns (address vault) {
          require(vaults[msg.sender] == address(0), "Vault already exists for this wallet");
          vault = vaultImplementation.clone();
          PersonalQryptSafeV2(vault).initialize(msg.sender, passwordHash, minShieldAmount);
          vaults[msg.sender] = vault;
          emit VaultCreated(msg.sender, vault);
      }

      // V2: admin can adjust global min shield (still some centralization)
      function setMinShieldAmount(uint256 newMin) external onlyOwner {
          require(newMin > 0, "Min must be positive");
          minShieldAmount = newMin;
          emit MinShieldAmountUpdated(newMin);
      }

      function hasVault(address wallet) external view returns (bool) { return vaults[wallet] != address(0); }
      function getVault(address wallet) external view returns (address) { return vaults[wallet]; }
  }
  