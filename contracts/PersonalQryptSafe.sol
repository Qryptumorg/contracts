// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./ShieldToken.sol";

contract PersonalQryptSafe is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public owner;
    bytes32 private passwordHash;
    bool public initialized;

    uint256 public lastActivityBlock;
    uint256 public constant EMERGENCY_DELAY_BLOCKS = 1_296_000;
    uint256 public constant COMMIT_EXPIRY_SECONDS = 600;
    uint256 public constant MINIMUM_SHIELD_AMOUNT = 1e6;

    mapping(address => address) public qTokens;
    mapping(bytes32 => CommitData) private commits;

    struct CommitData {
        uint256 blockNumber;
        uint256 timestamp;
        bool used;
    }

    event TokenShielded(address indexed token, uint256 amount, address indexed qToken);
    event TokenUnshielded(address indexed token, uint256 amount);
    event TransferExecuted(address indexed token, address indexed to, uint256 amount);
    event QTokenDeployed(address indexed token, address indexed qToken);
    event VaultProofChanged();
    event CommitSubmitted(bytes32 indexed commitHash);
    event EmergencyWithdraw(address indexed token, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not vault owner");
        _;
    }

    modifier notInitialized() {
        require(!initialized, "Already initialized");
        _;
    }

    function initialize(address _owner, bytes32 _passwordHash) external notInitialized {
        owner = _owner;
        passwordHash = _passwordHash;
        initialized = true;
        lastActivityBlock = block.number;
    }

    function getOrCreateQToken(address tokenAddress) internal returns (address) {
        if (qTokens[tokenAddress] != address(0)) {
            return qTokens[tokenAddress];
        }

        string memory name;
        string memory symbol;

        try ITokenMetadata(tokenAddress).name() returns (string memory n) {
            name = string(abi.encodePacked("q", n));
        } catch {
            name = "qToken";
        }

        try ITokenMetadata(tokenAddress).symbol() returns (string memory s) {
            symbol = string(abi.encodePacked("q", s));
        } catch {
            symbol = "qTKN";
        }

        uint8 underlyingDecimals = 18;
        try ITokenMetadata(tokenAddress).decimals() returns (uint8 d) {
            underlyingDecimals = d;
        } catch {}

        ShieldToken qToken = new ShieldToken(name, symbol, address(this), underlyingDecimals);
        qTokens[tokenAddress] = address(qToken);

        emit QTokenDeployed(tokenAddress, address(qToken));
        return address(qToken);
    }

    function shield(address tokenAddress, uint256 amount, string calldata password) external onlyOwner nonReentrant {
        require(verifyPassword(password), "Invalid vault proof");
        require(amount >= MINIMUM_SHIELD_AMOUNT, "Amount below minimum");

        uint256 balanceBefore = IERC20(tokenAddress).balanceOf(address(this));
        IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(tokenAddress).balanceOf(address(this)) - balanceBefore;

        address qTokenAddress = getOrCreateQToken(tokenAddress);
        ShieldToken(qTokenAddress).mint(owner, received);

        lastActivityBlock = block.number;
        emit TokenShielded(tokenAddress, received, qTokenAddress);
    }

    function unshield(address tokenAddress, uint256 amount, string calldata password) external onlyOwner nonReentrant {
        require(verifyPassword(password), "Invalid vault proof");
        require(amount > 0, "Amount must be greater than zero");

        address qTokenAddress = qTokens[tokenAddress];
        require(qTokenAddress != address(0), "Token not shielded");
        require(ShieldToken(qTokenAddress).balanceOf(owner) >= amount, "Insufficient shielded balance");

        ShieldToken(qTokenAddress).burn(owner, amount);
        IERC20(tokenAddress).safeTransfer(owner, amount);

        lastActivityBlock = block.number;
        emit TokenUnshielded(tokenAddress, amount);
    }

    function commitTransfer(bytes32 commitHash) external onlyOwner {
        require(!commits[commitHash].used, "Commit already used");
        require(commits[commitHash].blockNumber == 0, "Commit already exists");

        commits[commitHash] = CommitData({
            blockNumber: block.number,
            timestamp: block.timestamp,
            used: false
        });

        lastActivityBlock = block.number;
        emit CommitSubmitted(commitHash);
    }

    function revealTransfer(
        address tokenAddress,
        address to,
        uint256 amount,
        string calldata password,
        uint256 nonce
    ) external onlyOwner nonReentrant {
        require(verifyPassword(password), "Invalid vault proof");
        require(amount > 0, "Amount must be greater than zero");
        require(to != address(0), "Invalid recipient");
        require(to != msg.sender, "Cannot transfer to yourself");

        bytes32 commitHash = keccak256(abi.encodePacked(password, nonce, tokenAddress, to, amount));
        CommitData storage commit = commits[commitHash];
        require(commit.blockNumber != 0, "Commit not found");
        require(!commit.used, "Commit already used");
        require(block.number > commit.blockNumber, "Must wait one block after commit");
        require(block.timestamp <= commit.timestamp + COMMIT_EXPIRY_SECONDS, "Commit expired");

        commit.used = true;

        address qTokenAddress = qTokens[tokenAddress];
        require(qTokenAddress != address(0), "Token not shielded");
        require(ShieldToken(qTokenAddress).balanceOf(owner) >= amount, "Insufficient shielded balance");

        ShieldToken(qTokenAddress).burn(owner, amount);
        IERC20(tokenAddress).safeTransfer(to, amount);

        lastActivityBlock = block.number;
        emit TransferExecuted(tokenAddress, to, amount);
    }

    function changeVaultProof(string calldata oldPassword, string calldata newPassword) external onlyOwner {
        require(verifyPassword(oldPassword), "Invalid current vault proof");
        require(validatePasswordFormat(newPassword), "Invalid vault proof format");

        passwordHash = keccak256(abi.encodePacked(newPassword));
        lastActivityBlock = block.number;
        emit VaultProofChanged();
    }

    function emergencyWithdraw(address[] calldata tokenAddresses) external onlyOwner nonReentrant {
        require(
            block.number >= lastActivityBlock + EMERGENCY_DELAY_BLOCKS,
            "Emergency withdraw not yet available"
        );

        for (uint256 i = 0; i < tokenAddresses.length; i++) {
            address tokenAddress = tokenAddresses[i];
            uint256 balance = IERC20(tokenAddress).balanceOf(address(this));
            if (balance > 0) {
                IERC20(tokenAddress).safeTransfer(owner, balance);
                emit EmergencyWithdraw(tokenAddress, balance);
            }
        }
    }

    function verifyPassword(string memory password) internal view returns (bool) {
        return keccak256(abi.encodePacked(password)) == passwordHash;
    }

    function validatePasswordFormat(string memory password) internal pure returns (bool) {
        bytes memory p = bytes(password);
        if (p.length != 6) return false;

        uint8 letters = 0;
        uint8 digits = 0;

        for (uint256 i = 0; i < 6; i++) {
            uint8 c = uint8(p[i]);
            if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
                letters++;
            } else if (c >= 48 && c <= 57) {
                digits++;
            } else {
                return false;
            }
        }

        return letters == 3 && digits == 3;
    }

    function getQTokenAddress(address tokenAddress) external view returns (address) {
        return qTokens[tokenAddress];
    }

    function getShieldedBalance(address tokenAddress) external view returns (uint256) {
        address qTokenAddress = qTokens[tokenAddress];
        if (qTokenAddress == address(0)) return 0;
        return ShieldToken(qTokenAddress).balanceOf(owner);
    }

    function getEmergencyWithdrawAvailableBlock() external view returns (uint256) {
        return lastActivityBlock + EMERGENCY_DELAY_BLOCKS;
    }
}

interface ITokenMetadata {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}
