// SPDX-License-Identifier: MIT
  // Qryptum Protocol v2.0 -- https://qryptum.org
  pragma solidity 0.8.34;

  import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
  import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
  import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
  import "./ShieldToken.sol";

  // V2: Added nonce to commit-reveal (fix V1 commit replay)
  // V2: Added overflow protection via SafeERC20 + balance checks
  // Critical bug remaining: passwordHash static, visible after first TX attempt
  // Fixed in V3: ECDSA meta-signature + changeVaultProof
  contract PersonalQryptSafeV2 is ReentrancyGuard {
      using SafeERC20 for IERC20;

      bytes32 private constant _QRYPTUM_SALT = keccak256("qryptum.v2.sepolia");

      address public owner;
      bytes32 private passwordHash;
      bool public initialized;
      uint256 public minimumShieldAmount;

      uint256 public lastActivityBlock;
      uint256 public constant EMERGENCY_DELAY_BLOCKS = 1_296_000;
      uint256 public constant COMMIT_EXPIRY_SECONDS = 600;

      mapping(address => address) public qTokens;
      // V2: nonce added to CommitData to prevent cross-commit replay
      mapping(bytes32 => CommitData) private commits;
      uint256 private commitNonce;

      struct CommitData {
          uint256 blockNumber;
          uint256 timestamp;
          uint256 nonce;
          bool used;
      }

      event TokenShielded(address indexed token, uint256 amount, address indexed qToken);
      event TokenUnshielded(address indexed token, uint256 amount);
      event TransferExecuted(address indexed token, address indexed to, uint256 amount);
      event QTokenDeployed(address indexed token, address indexed qToken);
      event CommitSubmitted(bytes32 indexed commitHash, uint256 nonce);
      event EmergencyWithdraw(address indexed token, uint256 amount);

      modifier onlyOwner() {
          require(msg.sender == owner, "Not vault owner");
          _;
      }

      modifier notInitialized() {
          require(!initialized, "Already initialized");
          _;
      }

      modifier validProof(bytes32 proof) {
          require(keccak256(abi.encodePacked(proof)) == passwordHash, "Invalid vault proof");
          _;
      }

      function initialize(address _owner, bytes32 _passwordHash, uint256 _minShield) external notInitialized {
          owner = _owner;
          passwordHash = _passwordHash;
          minimumShieldAmount = _minShield;
          initialized = true;
          lastActivityBlock = block.number;
      }

      function getOrCreateQToken(address tokenAddress) internal returns (address) {
          if (qTokens[tokenAddress] != address(0)) return qTokens[tokenAddress];
          string memory name; string memory symbol; uint8 decimals = 18;
          try ITokenMetadataV2(tokenAddress).name() returns (string memory n) { name = string(abi.encodePacked("q", n)); } catch { name = "qToken"; }
          try ITokenMetadataV2(tokenAddress).symbol() returns (string memory s) { symbol = string(abi.encodePacked("q", s)); } catch { symbol = "qTKN"; }
          try ITokenMetadataV2(tokenAddress).decimals() returns (uint8 d) { decimals = d; } catch {}
          ShieldToken qToken = new ShieldToken(name, symbol, address(this), decimals);
          qTokens[tokenAddress] = address(qToken);
          emit QTokenDeployed(tokenAddress, address(qToken));
          return address(qToken);
      }

      function shield(address tokenAddress, uint256 amount, bytes32 proof) external onlyOwner nonReentrant validProof(proof) {
          require(amount >= minimumShieldAmount, "Amount below minimum");
          address qTokenAddress = getOrCreateQToken(tokenAddress);
          IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), amount);
          ShieldToken(qTokenAddress).mint(owner, amount);
          lastActivityBlock = block.number;
          emit TokenShielded(tokenAddress, amount, qTokenAddress);
      }

      function unshield(address tokenAddress, uint256 amount, bytes32 proof) external onlyOwner nonReentrant validProof(proof) {
          address qTokenAddress = qTokens[tokenAddress];
          require(qTokenAddress != address(0), "Token not shielded");
          // V2: explicit balance check before burn (overflow protection)
          uint256 balance = ShieldToken(qTokenAddress).balanceOf(owner);
          require(balance >= amount, "Insufficient shielded balance");
          ShieldToken(qTokenAddress).burn(owner, amount);
          IERC20(tokenAddress).safeTransfer(owner, amount);
          lastActivityBlock = block.number;
          emit TokenUnshielded(tokenAddress, amount);
      }

      // V2: commit now includes incrementing nonce in the hash binding
      function commit(bytes32 commitHash, bytes32 proof) external onlyOwner validProof(proof) {
          require(commits[commitHash].blockNumber == 0, "Commit already exists");
          commitNonce++;
          commits[commitHash] = CommitData({
              blockNumber: block.number,
              timestamp:   block.timestamp,
              nonce:       commitNonce,
              used:        false
          });
          lastActivityBlock = block.number;
          emit CommitSubmitted(commitHash, commitNonce);
      }

      function reveal(
          address tokenAddress,
          address to,
          uint256 amount,
          bytes32 proof,
          bytes32 commitHash
      ) external onlyOwner nonReentrant validProof(proof) {
          CommitData storage c = commits[commitHash];
          require(c.blockNumber != 0, "Commit not found");
          require(!c.used, "Commit already used");
          require(block.timestamp <= c.timestamp + COMMIT_EXPIRY_SECONDS, "Commit expired");
          address qTokenAddress = qTokens[tokenAddress];
          require(qTokenAddress != address(0), "Token not shielded");
          require(ShieldToken(qTokenAddress).balanceOf(owner) >= amount, "Insufficient balance");
          c.used = true;
          ShieldToken(qTokenAddress).burn(owner, amount);
          IERC20(tokenAddress).safeTransfer(to, amount);
          lastActivityBlock = block.number;
          emit TransferExecuted(tokenAddress, to, amount);
      }

      function emergencyWithdraw(address[] calldata tokenAddresses, bytes32 proof) external onlyOwner nonReentrant validProof(proof) {
          require(block.number >= lastActivityBlock + EMERGENCY_DELAY_BLOCKS, "Emergency delay not met");
          for (uint256 i = 0; i < tokenAddresses.length; i++) {
              uint256 balance = IERC20(tokenAddresses[i]).balanceOf(address(this));
              if (balance > 0) {
                  IERC20(tokenAddresses[i]).safeTransfer(owner, balance);
                  emit EmergencyWithdraw(tokenAddresses[i], balance);
              }
          }
      }

      function getQTokenAddress(address tokenAddress) external view returns (address) { return qTokens[tokenAddress]; }
      function getShieldedBalance(address tokenAddress) external view returns (uint256) {
          address q = qTokens[tokenAddress];
          if (q == address(0)) return 0;
          return ShieldToken(q).balanceOf(owner);
      }
      function getEmergencyWithdrawAvailableBlock() external view returns (uint256) { return lastActivityBlock + EMERGENCY_DELAY_BLOCKS; }
  }

  interface ITokenMetadataV2 {
      function name() external view returns (string memory);
      function symbol() external view returns (string memory);
      function decimals() external view returns (uint8);
  }
  