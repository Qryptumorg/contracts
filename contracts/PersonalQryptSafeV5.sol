// SPDX-License-Identifier: MIT
/*
 *
 *           ███████████████████████████████████████
 *           ███                                 ███
 *           ███                                 ███
 * ███████████████████████████████████████████████████████
 * ███████████████████████████████████████████████████████
 * ███                                                 ███
 * ███     ███  ████  █   █ ████  █████ █   █ █   █    ███
 * ███    █   █ █   █ █   █ █   █   █   █   █ ██ ██    ███
 * ███    █   █ ████   █ █  ████    █   █   █ █ █ █    ███
 * ███    █  ██ █ █     █   █       █   █   █ █   █    ███
 * ███     ██ █ █  █    █   █       █    ███  █   █    ███
 * ███                                                 ███
 * ███                      ████                       ███
 * ███                     ██  ██                      ███
 * ███                     ██  ██                      ███
 * ███                      ████                       ███
 * ███                       ██                        ███
 * ███                       ██                        ███
 * ███                                                 ███
 * ███████████████████████████████████████████████████████
 * ███████████████████████████████████████████████████████
 *
 */
// https://qryptum.org
pragma solidity 0.8.34;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./ShieldToken.sol";

contract PersonalQryptSafeV5 is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    address public owner;
    bytes32 private passwordHash;
    bool public initialized;

    uint256 public lastActivityBlock;
    uint256 public constant EMERGENCY_DELAY_BLOCKS = 1_296_000;
    uint256 public constant VEIL_EXPIRY_SECONDS    = 600;
    uint256 public constant MINIMUM_SHIELD_AMOUNT  = 1e6;

    mapping(address => address) public qTokens;
    mapping(bytes32 => VeilData) private veils;

    mapping(bytes32 => bool) public usedVoucherNonces;

    struct VeilData {
        uint256 blockNumber;
        uint256 timestamp;
        bool used;
    }

    bytes32 private constant _QRYPTAIR_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId)");
    bytes32 private constant _QRYPTAIR_NAME_HASH    = keccak256(bytes("QryptAir"));
    bytes32 private constant _QRYPTAIR_VERSION_HASH = keccak256(bytes("1"));

    bytes32 private constant _VOUCHER_TYPEHASH = keccak256(
        "Voucher(address token,uint256 amount,address recipient,uint256 deadline,bytes32 nonce,bytes32 transferCodeHash)"
    );

    event TokenQrypted(address indexed token, uint256 amount, address indexed qToken);
    event TokenUnqrypted(address indexed token, uint256 amount);
    event TransferUnveiled(address indexed token, address indexed to, uint256 amount);
    event QTokenCreated(address indexed token, address indexed qToken);
    event ProofRotated();
    event TransferVeiled(bytes32 indexed veilHash);
    event EmergencyExit(address indexed token, uint256 amount);
    event AirVoucherClaimed(
        bytes32 indexed nonce,
        address indexed token,
        uint256 amount,
        address indexed recipient
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Not QryptSafe owner");
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

        emit QTokenCreated(tokenAddress, address(qToken));
        return address(qToken);
    }

    // ── QryptSafe: deposit tokens into vault ─────────────────────────────
    // proofHash = keccak256(password) computed by frontend — raw password never on-chain
    function qrypt(
        address tokenAddress,
        uint256 amount,
        bytes32 proofHash
    ) external onlyOwner nonReentrant {
        require(proofHash == passwordHash, "Invalid vault proof");
        require(amount >= MINIMUM_SHIELD_AMOUNT, "Amount below minimum");

        uint256 balanceBefore = IERC20(tokenAddress).balanceOf(address(this));
        IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(tokenAddress).balanceOf(address(this)) - balanceBefore;

        address qTokenAddress = getOrCreateQToken(tokenAddress);
        ShieldToken(qTokenAddress).mint(owner, received);

        lastActivityBlock = block.number;
        emit TokenQrypted(tokenAddress, received, qTokenAddress);
    }

    // ── QryptSafe: withdraw tokens from vault ────────────────────────────
    function unqrypt(
        address tokenAddress,
        uint256 amount,
        bytes32 proofHash
    ) external onlyOwner nonReentrant {
        require(proofHash == passwordHash, "Invalid vault proof");
        require(amount > 0, "Amount must be greater than zero");

        address qTokenAddress = qTokens[tokenAddress];
        require(qTokenAddress != address(0), "Token not qrypted");
        require(ShieldToken(qTokenAddress).balanceOf(owner) >= amount, "Insufficient qrypted balance");

        ShieldToken(qTokenAddress).burn(owner, amount);
        IERC20(tokenAddress).safeTransfer(owner, amount);

        lastActivityBlock = block.number;
        emit TokenUnqrypted(tokenAddress, amount);
    }

    // ── QryptSafe: veil phase of veil-unveil transfer ─────────────────────
    // veilHash = keccak256(abi.encodePacked(proofHash, nonce, tokenAddress, to, amount))
    // proofHash is hashed off-chain — raw password never on-chain
    function veilTransfer(bytes32 veilHash) external onlyOwner {
        require(!veils[veilHash].used, "Veil already used");
        require(veils[veilHash].blockNumber == 0, "Veil already exists");

        veils[veilHash] = VeilData({
            blockNumber: block.number,
            timestamp:   block.timestamp,
            used:        false
        });

        lastActivityBlock = block.number;
        emit TransferVeiled(veilHash);
    }

    // ── QryptSafe: unveil phase of veil-unveil transfer ──────────────────
    // veilHash must equal keccak256(abi.encodePacked(proofHash, nonce, tokenAddress, to, amount))
    function unveilTransfer(
        address tokenAddress,
        address to,
        uint256 amount,
        bytes32 proofHash,
        uint256 nonce
    ) external onlyOwner nonReentrant {
        require(proofHash == passwordHash, "Invalid vault proof");
        require(amount > 0, "Amount must be greater than zero");
        require(to != address(0), "Invalid recipient");
        require(to != msg.sender, "Cannot transfer to yourself");

        bytes32 veilHash = keccak256(abi.encodePacked(proofHash, nonce, tokenAddress, to, amount));
        VeilData storage veil = veils[veilHash];
        require(veil.blockNumber != 0, "Veil not found");
        require(!veil.used, "Veil already used");
        require(block.number > veil.blockNumber, "Must wait one block after veil");
        require(block.timestamp <= veil.timestamp + VEIL_EXPIRY_SECONDS, "Veil expired");

        veil.used = true;

        address qTokenAddress = qTokens[tokenAddress];
        require(qTokenAddress != address(0), "Token not qrypted");
        require(ShieldToken(qTokenAddress).balanceOf(owner) >= amount, "Insufficient qrypted balance");

        ShieldToken(qTokenAddress).burn(owner, amount);
        IERC20(tokenAddress).safeTransfer(to, amount);

        lastActivityBlock = block.number;
        emit TransferUnveiled(tokenAddress, to, amount);
    }

    // ── QryptSafe: rotate vault proof ────────────────────────────────────
    function rotateProof(bytes32 oldHash, bytes32 newHash) external onlyOwner {
        require(oldHash == passwordHash, "Invalid current vault proof");
        require(newHash != bytes32(0), "Invalid new vault proof");

        passwordHash = newHash;
        lastActivityBlock = block.number;
        emit ProofRotated();
    }

    // ── QryptSafe: emergency exit after inactivity ───────────────────────
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
                emit EmergencyExit(tokenAddress, balance);
            }
        }
    }

    // ── QryptAir: claim an offline-signed EIP-712 voucher ────────────────
    // transferCodeHash = keccak256(transferCode) computed by recipient frontend
    // raw transferCode never enters the TX calldata
    function claimAirVoucher(
        address token,
        uint256 amount,
        address recipient,
        uint256 deadline,
        bytes32 nonce,
        bytes32 transferCodeHash,
        bytes   calldata signature
    ) external nonReentrant {
        require(token     != address(0), "Invalid token");
        require(recipient != address(0), "Invalid recipient");
        require(amount    >  0,          "Zero amount");
        require(block.timestamp <= deadline, "Voucher expired");
        require(!usedVoucherNonces[nonce], "Voucher already redeemed");

        bytes32 domainSeparator = keccak256(abi.encode(
            _QRYPTAIR_DOMAIN_TYPEHASH,
            _QRYPTAIR_NAME_HASH,
            _QRYPTAIR_VERSION_HASH,
            block.chainid
        ));

        bytes32 structHash = keccak256(abi.encode(
            _VOUCHER_TYPEHASH,
            token,
            amount,
            recipient,
            deadline,
            nonce,
            transferCodeHash
        ));

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        address signer = ECDSA.recover(digest, signature);
        require(signer != address(0), "ECDSA: invalid sig");
        require(signer == owner,      "Sig not from vault owner");

        address qTokenAddr = qTokens[token];
        require(qTokenAddr != address(0),                           "Token not qrypted");
        require(ShieldToken(qTokenAddr).balanceOf(owner) >= amount, "Insufficient qrypted balance");

        usedVoucherNonces[nonce] = true;
        lastActivityBlock = block.number;

        ShieldToken(qTokenAddr).burn(owner, amount);
        IERC20(token).safeTransfer(recipient, amount);

        emit AirVoucherClaimed(nonce, token, amount, recipient);
    }

    // ── QryptShield: atomic unqrypt-to-Railgun ───────────────────────────
    // Burns qTokens, approves Railgun, and calls Railgun.shield() in one TX.
    // railgunCalldata is built off-chain by the frontend via buildShieldTx().
    // railgunProxy is the address returned by buildShieldTx().to.
    // msg.value is forwarded to Railgun in case the shield call requires ETH.
    function railgun(
        address tokenAddress,
        uint256 amount,
        bytes32 proofHash,
        address railgunProxy,
        bytes calldata railgunCalldata
    ) external payable onlyOwner nonReentrant {
        require(proofHash == passwordHash, "Invalid vault proof");
        require(railgunProxy != address(0), "Invalid Railgun proxy");
        require(amount > 0, "Amount must be greater than zero");

        address qTokenAddress = qTokens[tokenAddress];
        require(qTokenAddress != address(0), "Token not qrypted");
        require(ShieldToken(qTokenAddress).balanceOf(owner) >= amount, "Insufficient qrypted balance");

        ShieldToken(qTokenAddress).burn(owner, amount);

        IERC20(tokenAddress).approve(railgunProxy, amount);

        (bool ok,) = railgunProxy.call{value: msg.value}(railgunCalldata);
        require(ok, "Railgun shield failed");

        IERC20(tokenAddress).approve(railgunProxy, 0);

        lastActivityBlock = block.number;
        emit TokenUnqrypted(tokenAddress, amount);
    }

    // ── View functions ────────────────────────────────────────────────────

    function getQTokenAddress(address tokenAddress) external view returns (address) {
        return qTokens[tokenAddress];
    }

    function getQryptedBalance(address tokenAddress) external view returns (uint256) {
        address qTokenAddress = qTokens[tokenAddress];
        if (qTokenAddress == address(0)) return 0;
        return ShieldToken(qTokenAddress).balanceOf(owner);
    }

    function getEmergencyWithdrawAvailableBlock() external view returns (uint256) {
        return lastActivityBlock + EMERGENCY_DELAY_BLOCKS;
    }
}

interface ITokenMetadata {
    function name()     external view returns (string memory);
    function symbol()   external view returns (string memory);
    function decimals() external view returns (uint8);
}
