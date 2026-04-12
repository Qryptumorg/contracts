// SPDX-License-Identifier: MIT
// Qryptum Protocol v4.0 -- https://qryptum.org
pragma solidity 0.8.34;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./ShieldToken.sol";

// V4: All require strings replaced with custom errors (gas efficient)
// V4: Vault metadata: createdAtBlock, lastActivityBlock, activityCount
// V4: Partial unshield: can unshield any amount <= balance
// Critical bug remaining: no Railgun, no QryptAir, no OTP chain
// Fixed in V5 and V6
contract PersonalQryptSafeV4 is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    bytes32 private constant _QRYPTUM_SALT = keccak256("qryptum.v4.sepolia");

    address public owner;
    bytes32 private passwordHash;
    bool public initialized;

    uint256 public createdAtBlock;
    uint256 public lastActivityBlock;
    uint256 public activityCount;
    uint256 public constant EMERGENCY_DELAY_BLOCKS = 1_296_000;
    uint256 public constant COMMIT_EXPIRY_SECONDS = 600;
    uint256 public constant MINIMUM_SHIELD_AMOUNT = 1e6;

    mapping(address => address) public qTokens;
    mapping(bytes32 => CommitData) private commits;
    mapping(bytes32 => bool) public usedSignatureHashes;
    uint256 private commitNonce;

    struct CommitData {
        uint256 blockNumber;
        uint256 timestamp;
        uint256 nonce;
        bool used;
    }

    error NotOwner();
    error AlreadyInitialized();
    error InvalidProof();
    error InvalidAmount();
    error TokenNotShielded();
    error InsufficientBalance();
    error CommitExists();
    error CommitNotFound();
    error CommitUsed();
    error CommitExpired();
    error SignatureExpired();
    error SignatureUsed();
    error InvalidSignature();
    error EmergencyDelayNotMet();
    error InvalidNewProof();

    event TokenShielded(address indexed token, uint256 amount, address indexed qToken);
    event TokenUnshielded(address indexed token, uint256 amount);
    event TransferExecuted(address indexed token, address indexed to, uint256 amount);
    event QTokenDeployed(address indexed token, address indexed qToken);
    event CommitSubmitted(bytes32 indexed commitHash, uint256 nonce);
    event VaultProofChanged();
    event EmergencyWithdraw(address indexed token, uint256 amount);

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier notInitialized() { if (initialized) revert AlreadyInitialized(); _; }
    modifier validProof(bytes32 proof) { if (keccak256(abi.encodePacked(proof)) != passwordHash) revert InvalidProof(); _; }

    function initialize(address _owner, bytes32 _passwordHash) external notInitialized {
        owner = _owner;
        passwordHash = _passwordHash;
        initialized = true;
        createdAtBlock = block.number;
        lastActivityBlock = block.number;
    }

    function changeVaultProof(bytes32 oldProof, bytes32 newPasswordHash) external onlyOwner validProof(oldProof) {
        if (newPasswordHash == bytes32(0)) revert InvalidNewProof();
        passwordHash = newPasswordHash;
        lastActivityBlock = block.number;
        activityCount++;
        emit VaultProofChanged();
    }

    function getOrCreateQToken(address tokenAddress) internal returns (address) {
        if (qTokens[tokenAddress] != address(0)) return qTokens[tokenAddress];
        string memory name; string memory symbol; uint8 decimals = 18;
        try ITokenMetadataV4(tokenAddress).name() returns (string memory n) { name = string(abi.encodePacked("q", n)); } catch { name = "qToken"; }
        try ITokenMetadataV4(tokenAddress).symbol() returns (string memory s) { symbol = string(abi.encodePacked("q", s)); } catch { symbol = "qTKN"; }
        try ITokenMetadataV4(tokenAddress).decimals() returns (uint8 d) { decimals = d; } catch {}
        ShieldToken qToken = new ShieldToken(name, symbol, address(this), decimals);
        qTokens[tokenAddress] = address(qToken);
        emit QTokenDeployed(tokenAddress, address(qToken));
        return address(qToken);
    }

    function shield(address tokenAddress, uint256 amount, bytes32 proof) external onlyOwner nonReentrant validProof(proof) {
        if (amount < MINIMUM_SHIELD_AMOUNT) revert InvalidAmount();
        address qTokenAddress = getOrCreateQToken(tokenAddress);
        IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), amount);
        ShieldToken(qTokenAddress).mint(owner, amount);
        lastActivityBlock = block.number;
        activityCount++;
        emit TokenShielded(tokenAddress, amount, qTokenAddress);
    }

    function unshield(address tokenAddress, uint256 amount, bytes32 proof) external onlyOwner nonReentrant validProof(proof) {
        address qTokenAddress = qTokens[tokenAddress];
        if (qTokenAddress == address(0)) revert TokenNotShielded();
        if (ShieldToken(qTokenAddress).balanceOf(owner) < amount) revert InsufficientBalance();
        ShieldToken(qTokenAddress).burn(owner, amount);
        IERC20(tokenAddress).safeTransfer(owner, amount);
        lastActivityBlock = block.number;
        activityCount++;
        emit TokenUnshielded(tokenAddress, amount);
    }

    function commit(bytes32 commitHash, bytes32 proof) external onlyOwner validProof(proof) {
        if (commits[commitHash].blockNumber != 0) revert CommitExists();
        commitNonce++;
        commits[commitHash] = CommitData({ blockNumber: block.number, timestamp: block.timestamp, nonce: commitNonce, used: false });
        lastActivityBlock = block.number;
        activityCount++;
        emit CommitSubmitted(commitHash, commitNonce);
    }

    function reveal(address tokenAddress, address to, uint256 amount, bytes32 proof, bytes32 commitHash) external onlyOwner nonReentrant validProof(proof) {
        CommitData storage c = commits[commitHash];
        if (c.blockNumber == 0) revert CommitNotFound();
        if (c.used) revert CommitUsed();
        if (block.timestamp > c.timestamp + COMMIT_EXPIRY_SECONDS) revert CommitExpired();
        address qTokenAddress = qTokens[tokenAddress];
        if (qTokenAddress == address(0)) revert TokenNotShielded();
        if (ShieldToken(qTokenAddress).balanceOf(owner) < amount) revert InsufficientBalance();
        c.used = true;
        ShieldToken(qTokenAddress).burn(owner, amount);
        IERC20(tokenAddress).safeTransfer(to, amount);
        lastActivityBlock = block.number;
        activityCount++;
        emit TransferExecuted(tokenAddress, to, amount);
    }

    function metaTransfer(address tokenAddress, address to, uint256 amount, uint256 deadline, bytes32 sigNonce, bytes calldata signature) external nonReentrant {
        if (block.timestamp > deadline) revert SignatureExpired();
        bytes32 sigHash = keccak256(abi.encodePacked(tokenAddress, to, amount, deadline, sigNonce));
        if (usedSignatureHashes[sigHash]) revert SignatureUsed();
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", sigHash));
        address recovered = ECDSA.recover(ethHash, signature);
        if (recovered != owner) revert InvalidSignature();
        address qTokenAddress = qTokens[tokenAddress];
        if (qTokenAddress == address(0)) revert TokenNotShielded();
        if (ShieldToken(qTokenAddress).balanceOf(owner) < amount) revert InsufficientBalance();
        usedSignatureHashes[sigHash] = true;
        ShieldToken(qTokenAddress).burn(owner, amount);
        IERC20(tokenAddress).safeTransfer(to, amount);
        lastActivityBlock = block.number;
        activityCount++;
        emit TransferExecuted(tokenAddress, to, amount);
    }

    function emergencyWithdraw(address[] calldata tokenAddresses, bytes32 proof) external onlyOwner nonReentrant validProof(proof) {
        if (block.number < lastActivityBlock + EMERGENCY_DELAY_BLOCKS) revert EmergencyDelayNotMet();
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

interface ITokenMetadataV4 {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}
