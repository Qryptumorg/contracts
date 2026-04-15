// SPDX-License-Identifier: MIT
/*
 *
 *         ███████████████████████████████████████
 *         ███                                 ███
 *         ███                                 ███
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

contract QryptSafe is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public owner;
    bytes32 private proofChainHead;
    bool public initialized;

    uint256 public lastActivityBlock;
    uint256 public constant EMERGENCY_DELAY_BLOCKS = 1_296_000;
    uint256 public constant COMMIT_EXPIRY_SECONDS  = 600;
    uint256 public constant MINIMUM_SHIELD_AMOUNT  = 1e6;

    mapping(address => address)   public  qTokens;
    mapping(bytes32 => InitData)  private inits;
    mapping(bytes32 => bool)      public  usedVoucherNonces;
    mapping(address => uint256)   private airBags;

    struct InitData {
        uint256 blockNumber;
        uint256 timestamp;
        bool    used;
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
    event TransferInitiated(bytes32 indexed initHash);
    event TransferFinalized(address indexed token, address indexed to, uint256 amount);
    event QTokenCreated(address indexed token, address indexed qToken);
    event ChainRecharged(bytes32 newHead);
    event OffTokenMinted(address indexed token, uint256 amount);
    event OffTokenReclaimed(address indexed token, uint256 amount);
    event EmergencyExit(address indexed token, uint256 amount);
    event AirVoucherClaimed(
        bytes32 indexed nonce,
        address indexed token,
        uint256         amount,
        address indexed recipient
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Not vault owner");
        _;
    }

    modifier notInitialized() {
        require(!initialized, "Already initialized");
        _;
    }

    function initialize(address _owner, bytes32 _initialChainHead) external notInitialized {
        owner            = _owner;
        proofChainHead   = _initialChainHead;
        initialized      = true;
        lastActivityBlock = block.number;
    }

    function _consumeProof(bytes32 proof) internal {
        require(
            keccak256(abi.encodePacked(proof)) == proofChainHead,
            "Invalid vault proof"
        );
        proofChainHead = proof;
    }

    function _getOrCreateQToken(address tokenAddress) internal returns (address) {
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

    // ── QryptSafe: deposit tokens into vault ─────────────────────────────────
    function Qrypt(
        address tokenAddress,
        uint256 amount,
        bytes32 proof
    ) external onlyOwner nonReentrant {
        _consumeProof(proof);
        require(amount >= MINIMUM_SHIELD_AMOUNT, "Amount below minimum");

        uint256 balanceBefore = IERC20(tokenAddress).balanceOf(address(this));
        IERC20(tokenAddress).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(tokenAddress).balanceOf(address(this)) - balanceBefore;

        address qTokenAddress = _getOrCreateQToken(tokenAddress);
        ShieldToken(qTokenAddress).mint(owner, received);

        lastActivityBlock = block.number;
        emit TokenQrypted(tokenAddress, received, qTokenAddress);
    }

    // ── QryptSafe: withdraw tokens from vault ────────────────────────────────
    function unQrypt(
        address tokenAddress,
        uint256 amount,
        bytes32 proof
    ) external onlyOwner nonReentrant {
        _consumeProof(proof);
        require(amount > 0, "Amount must be greater than zero");

        address qTokenAddress = qTokens[tokenAddress];
        require(qTokenAddress != address(0), "Token not qrypted");
        require(ShieldToken(qTokenAddress).balanceOf(owner) >= amount, "Insufficient qrypted balance");

        ShieldToken(qTokenAddress).burn(owner, amount);
        IERC20(tokenAddress).safeTransfer(owner, amount);

        lastActivityBlock = block.number;
        emit TokenUnqrypted(tokenAddress, amount);
    }

    // ── QryptSafe: step 1 of init-finalize transfer ───────────────────────────
    function initTransfer(bytes32 initHash) external onlyOwner {
        require(inits[initHash].blockNumber == 0, "Init already exists");

        inits[initHash] = InitData({
            blockNumber: block.number,
            timestamp:   block.timestamp,
            used:        false
        });

        lastActivityBlock = block.number;
        emit TransferInitiated(initHash);
    }

    // ── QryptSafe: step 2 of init-finalize transfer ───────────────────────────
    function finalizeTransfer(
        address tokenAddress,
        address to,
        uint256 amount,
        bytes32 proof,
        uint256 nonce
    ) external onlyOwner nonReentrant {
        _consumeProof(proof);
        require(amount > 0,           "Amount must be greater than zero");
        require(to != address(0),     "Invalid recipient");
        require(to != msg.sender,     "Cannot transfer to yourself");

        bytes32 initHash = keccak256(abi.encodePacked(proof, nonce, tokenAddress, to, amount));
        InitData storage init = inits[initHash];
        require(init.blockNumber != 0,                                        "Init not found");
        require(!init.used,                                                   "Init already used");
        require(block.number > init.blockNumber,                              "Must wait one block after init");
        require(block.timestamp <= init.timestamp + COMMIT_EXPIRY_SECONDS,   "Init expired");

        init.used = true;

        address qTokenAddress = qTokens[tokenAddress];
        require(qTokenAddress != address(0),                                  "Token not qrypted");
        require(ShieldToken(qTokenAddress).balanceOf(owner) >= amount,        "Insufficient qrypted balance");

        ShieldToken(qTokenAddress).burn(owner, amount);
        IERC20(tokenAddress).safeTransfer(to, amount);

        lastActivityBlock = block.number;
        emit TransferFinalized(tokenAddress, to, amount);
    }

    // ── OTP chain: recharge when chain is exhausted ───────────────────────────
    function rechargeChain(bytes32 newHead, bytes32 currentProof) external onlyOwner {
        require(
            keccak256(abi.encodePacked(currentProof)) == proofChainHead,
            "Invalid recharge proof"
        );
        require(newHead != bytes32(0), "Invalid new chain head");
        proofChainHead    = newHead;
        lastActivityBlock = block.number;
        emit ChainRecharged(newHead);
    }

    // ── QryptAir: mint offTokens from qrypted balance ─────────────────────────
    function mintOffToken(
        address token,
        uint256 amount,
        bytes32 proof
    ) external onlyOwner nonReentrant {
        _consumeProof(proof);
        require(amount > 0, "Amount must be greater than zero");

        address qTokenAddress = qTokens[token];
        require(qTokenAddress != address(0),                            "Token not qrypted");
        require(ShieldToken(qTokenAddress).balanceOf(owner) >= amount,  "Insufficient qrypted balance");

        ShieldToken(qTokenAddress).burn(owner, amount);
        airBags[token] += amount;

        lastActivityBlock = block.number;
        emit OffTokenMinted(token, amount);
    }

    // ── QryptAir: reclaim unused offTokens back to qrypted balance ────────────
    function reclaimOffToken(
        address token,
        bytes32 proof
    ) external onlyOwner nonReentrant {
        _consumeProof(proof);
        uint256 budget = airBags[token];
        require(budget > 0, "No offTokens to reclaim");

        airBags[token] = 0;

        address qTokenAddress = _getOrCreateQToken(token);
        ShieldToken(qTokenAddress).mint(owner, budget);

        lastActivityBlock = block.number;
        emit OffTokenReclaimed(token, budget);
    }

    // ── QryptAir: redeem an offline-signed EIP-712 voucher ────────────────────
    function claimAirVoucher(
        address  token,
        uint256  amount,
        address  recipient,
        uint256  deadline,
        bytes32  nonce,
        bytes32  transferCodeHash,
        bytes calldata signature
    ) external nonReentrant {
        require(token                    != address(0), "Invalid token");
        require(recipient                != address(0), "Invalid recipient");
        require(amount                   >  0,          "Zero amount");
        require(block.timestamp          <= deadline,   "Voucher expired");
        require(!usedVoucherNonces[nonce],              "Voucher already redeemed");
        require(airBags[token]           >= amount,     "Insufficient offTokens");

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
        require(signer == owner, "Sig not from vault owner");

        usedVoucherNonces[nonce] = true;
        airBags[token]          -= amount;
        lastActivityBlock        = block.number;

        IERC20(token).safeTransfer(recipient, amount);
        emit AirVoucherClaimed(nonce, token, amount, recipient);
    }

    // ── QryptShield: atomic unQrypt-to-Railgun ────────────────────────────────
    function enterRailgun(
        address tokenAddress,
        uint256 amount,
        bytes32 proof,
        address railgunProxy,
        bytes calldata shieldCalldata
    ) external payable onlyOwner nonReentrant {
        _consumeProof(proof);
        require(railgunProxy  != address(0), "Invalid Railgun proxy");
        require(amount        >  0,          "Amount must be greater than zero");

        address qTokenAddress = qTokens[tokenAddress];
        require(qTokenAddress != address(0),                           "Token not qrypted");
        require(ShieldToken(qTokenAddress).balanceOf(owner) >= amount, "Insufficient qrypted balance");

        ShieldToken(qTokenAddress).burn(owner, amount);

        IERC20(tokenAddress).approve(railgunProxy, amount);
        (bool ok,) = railgunProxy.call{value: msg.value}(shieldCalldata);
        require(ok, "Railgun shield failed");
        IERC20(tokenAddress).approve(railgunProxy, 0);

        lastActivityBlock = block.number;
        emit TokenUnqrypted(tokenAddress, amount);
    }

    // ── Emergency: withdraw after prolonged inactivity ────────────────────────
    function emergencyWithdraw(address[] calldata tokenAddresses) external onlyOwner nonReentrant {
        require(
            block.number >= lastActivityBlock + EMERGENCY_DELAY_BLOCKS,
            "Emergency withdraw not yet available"
        );

        for (uint256 i = 0; i < tokenAddresses.length; ++i) {
            address tokenAddress = tokenAddresses[i];
            uint256 balance = IERC20(tokenAddress).balanceOf(address(this));
            if (balance > 0) {
                IERC20(tokenAddress).safeTransfer(owner, balance);
                emit EmergencyExit(tokenAddress, balance);
            }
        }
    }

    // ── View functions ────────────────────────────────────────────────────────

    function getQTokenAddress(address tokenAddress) external view returns (address) {
        return qTokens[tokenAddress];
    }

    function getQryptedBalance(address tokenAddress) external view returns (uint256) {
        address qTokenAddress = qTokens[tokenAddress];
        if (qTokenAddress == address(0)) return 0;
        return ShieldToken(qTokenAddress).balanceOf(owner);
    }

    function getAirBags(address token) external view returns (uint256) {
        return airBags[token];
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
