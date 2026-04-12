// SPDX-License-Identifier: MIT
// Qryptum Protocol v3.0 -- https://qryptum.org
pragma solidity 0.8.34;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./ShieldToken.sol";

// V3: changeVaultProof() -- rotate passwordHash without re-deploy
// V3: metaTransfer() -- EIP-712 signed transfer, executable by any relayer (ECDSA fix)
// V3: MINIMUM_SHIELD_AMOUNT constant (no admin required)
// Known bug remaining: passwordHash is a static keccak256 -- fixed in V4 with OTP chain
contract PersonalQryptSafeV3 is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    bytes32 private constant _QRYPTUM_SALT    = keccak256("qryptum.v3.sepolia");
    bytes32 private constant _META_TYPEHASH   = keccak256(
        "MetaTransfer(address token,address to,uint256 amount,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant _DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    address public owner;
    bytes32 private passwordHash;
    bool    public initialized;

    uint256 public constant MINIMUM_SHIELD_AMOUNT  = 1_000_000;
    uint256 public constant EMERGENCY_DELAY_BLOCKS = 1_296_000;
    uint256 public constant COMMIT_EXPIRY_SECONDS  = 600;

    uint256 public lastActivityBlock;

    mapping(address  => address) public qTokens;
    mapping(bytes32  => CommitData) private commits;
    mapping(uint256  => bool) public usedMetaNonces;
    uint256 private commitNonce;

    struct CommitData {
        uint256 blockNumber;
        uint256 timestamp;
        uint256 nonce;
        bool    used;
    }

    event TokenShielded(address indexed token, uint256 amount, address indexed qToken);
    event TokenUnshielded(address indexed token, uint256 amount);
    event TransferExecuted(address indexed token, address indexed to, uint256 amount);
    event MetaTransferExecuted(address indexed token, address indexed to, uint256 amount, uint256 nonce);
    event QTokenDeployed(address indexed token, address indexed qToken);
    event CommitSubmitted(bytes32 indexed commitHash, uint256 nonce);
    event ProofChanged();
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

    function initialize(address _owner, bytes32 _passwordHash) external notInitialized {
        owner        = _owner;
        passwordHash = _passwordHash;
        initialized  = true;
        lastActivityBlock = block.number;
    }

    function _getOrCreateQToken(address tokenAddress) internal returns (address) {
        if (qTokens[tokenAddress] != address(0)) return qTokens[tokenAddress];
        string memory name; string memory symbol; uint8 decimals = 18;
        try ITokenMetadataV3(tokenAddress).name()     returns (string memory n) { name    = string(abi.encodePacked("q", n)); } catch { name    = "qToken"; }
        try ITokenMetadataV3(tokenAddress).symbol()   returns (string memory s) { symbol  = string(abi.encodePacked("q", s)); } catch { symbol  = "qTKN";  }
        try ITokenMetadataV3(tokenAddress).decimals() returns (uint8 d)         { decimals = d; }                               catch {}
        ShieldToken qToken = new ShieldToken(name, symbol, address(this), decimals);
        qTokens[tokenAddress] = address(qToken);
        emit QTokenDeployed(tokenAddress, address(qToken));
        return address(qToken);
    }

    // ── QryptSafe core ───────────────────────────────────────────────────────

    function shield(address tokenAddress, uint256 amount, bytes32 proof)
        external onlyOwner nonReentrant validProof(proof)
    {
        require(amount >= MINIMUM_SHIELD_AMOUNT, "Amount below minimum");
        address qTokenAddress = _getOrCreateQToken(tokenAddress);
        IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), amount);
        ShieldToken(qTokenAddress).mint(owner, amount);
        lastActivityBlock = block.number;
        emit TokenShielded(tokenAddress, amount, qTokenAddress);
    }

    function unshield(address tokenAddress, uint256 amount, bytes32 proof)
        external onlyOwner nonReentrant validProof(proof)
    {
        address qTokenAddress = qTokens[tokenAddress];
        require(qTokenAddress != address(0), "Token not shielded");
        uint256 balance = ShieldToken(qTokenAddress).balanceOf(owner);
        require(balance >= amount, "Insufficient shielded balance");
        ShieldToken(qTokenAddress).burn(owner, amount);
        IERC20(tokenAddress).safeTransfer(owner, amount);
        lastActivityBlock = block.number;
        emit TokenUnshielded(tokenAddress, amount);
    }

    // ── Commit-reveal transfer ───────────────────────────────────────────────

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
        require(!c.used,            "Commit already used");
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

    // ── V3: changeVaultProof ─────────────────────────────────────────────────

    function changeVaultProof(bytes32 newPasswordHash, bytes32 currentProof)
        external onlyOwner validProof(currentProof)
    {
        require(newPasswordHash != bytes32(0), "Invalid new proof hash");
        passwordHash = newPasswordHash;
        lastActivityBlock = block.number;
        emit ProofChanged();
    }

    // ── V3: ECDSA meta-transfer (EIP-712) ────────────────────────────────────

    function metaTransfer(
        address tokenAddress,
        address to,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        require(block.timestamp <= deadline,  "Meta-transfer expired");
        require(!usedMetaNonces[nonce],        "Nonce already used");

        bytes32 domainSeparator = keccak256(abi.encode(
            _DOMAIN_TYPEHASH,
            keccak256("QryptSafe"),
            keccak256("3"),
            block.chainid,
            address(this)
        ));
        bytes32 structHash = keccak256(abi.encode(
            _META_TYPEHASH,
            tokenAddress,
            to,
            amount,
            nonce,
            deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        address signer = digest.recover(signature);
        require(signer == owner, "Invalid signature");

        usedMetaNonces[nonce] = true;
        address qTokenAddress = qTokens[tokenAddress];
        require(qTokenAddress != address(0), "Token not shielded");
        require(ShieldToken(qTokenAddress).balanceOf(owner) >= amount, "Insufficient balance");
        ShieldToken(qTokenAddress).burn(owner, amount);
        IERC20(tokenAddress).safeTransfer(to, amount);
        lastActivityBlock = block.number;
        emit MetaTransferExecuted(tokenAddress, to, amount, nonce);
    }

    // ── Emergency ────────────────────────────────────────────────────────────

    function emergencyWithdraw(address[] calldata tokenAddresses, bytes32 proof)
        external onlyOwner nonReentrant validProof(proof)
    {
        require(block.number >= lastActivityBlock + EMERGENCY_DELAY_BLOCKS, "Emergency delay not met");
        for (uint256 i = 0; i < tokenAddresses.length; i++) {
            uint256 balance = IERC20(tokenAddresses[i]).balanceOf(address(this));
            if (balance > 0) {
                IERC20(tokenAddresses[i]).safeTransfer(owner, balance);
                emit EmergencyWithdraw(tokenAddresses[i], balance);
            }
        }
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function getQTokenAddress(address tokenAddress) external view returns (address) { return qTokens[tokenAddress]; }
    function getShieldedBalance(address tokenAddress) external view returns (uint256) {
        address q = qTokens[tokenAddress];
        if (q == address(0)) return 0;
        return ShieldToken(q).balanceOf(owner);
    }
    function getEmergencyWithdrawAvailableBlock() external view returns (uint256) {
        return lastActivityBlock + EMERGENCY_DELAY_BLOCKS;
    }
}

interface ITokenMetadataV3 {
    function name()     external view returns (string memory);
    function symbol()   external view returns (string memory);
    function decimals() external view returns (uint8);
}
