const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time }   = require("@nomicfoundation/hardhat-network-helpers");

describe("QryptSafeV5", function () {
    let factory, vault, token, token2, owner, attacker, recipient, relayer;
    const VAULT_PROOF = "pqr678";
    let passwordHash;

    const USDC = (n) => ethers.parseUnits(String(n), 6);

    function buildVeilHash(nonce, tokenAddr, to, amount) {
        return ethers.keccak256(
            ethers.solidityPacked(
                ["bytes32", "uint256", "address", "address", "uint256"],
                [passwordHash, nonce, tokenAddr, to, amount]
            )
        );
    }

    async function signAirVoucher(signer, vaultAddr, token, amount, recipient, deadline, nonce, transferCodeHash) {
        const chainId = (await ethers.provider.getNetwork()).chainId;
        // Use signTypedData — ethers computes the EIP-712 digest and signs it directly
        // (no extra Ethereum prefix), matching Solidity's ECDSA.recover(digest, sig)
        return signer.signTypedData(
            { name: "QryptAir", version: "1", chainId },
            {
                Voucher: [
                    { name: "token",            type: "address" },
                    { name: "amount",           type: "uint256" },
                    { name: "recipient",        type: "address" },
                    { name: "deadline",         type: "uint256" },
                    { name: "nonce",            type: "bytes32" },
                    { name: "transferCodeHash", type: "bytes32" },
                ],
            },
            { token, amount, recipient, deadline, nonce, transferCodeHash }
        );
    }

    beforeEach(async () => {
        [, owner, attacker, recipient, relayer] = await ethers.getSigners();
        passwordHash = ethers.keccak256(ethers.toUtf8Bytes(VAULT_PROOF));

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        token  = await MockERC20.deploy("USD Coin", "USDC", 6);
        token2 = await MockERC20.deploy("Tether",   "USDT", 6);

        const Factory = await ethers.getContractFactory("contracts/QryptSafeV5.sol:QryptSafeV5");
        factory = await Factory.deploy();
        await factory.connect(owner).createQryptSafe(passwordHash);
        const vaultAddr = await factory.getQryptSafe(owner.address);
        vault = await ethers.getContractAt("contracts/PersonalQryptSafeV5.sol:PersonalQryptSafeV5", vaultAddr);

        await token.mint(owner.address,  USDC(10_000));
        await token2.mint(owner.address, USDC(10_000));
        await token.connect(owner).approve(vaultAddr, ethers.MaxUint256);
        await token2.connect(owner).approve(vaultAddr, ethers.MaxUint256);
    });

    // ── GROUP 1: Factory & QryptSafe (1-7) ─────────────────────────────────

    it("01 factory has no admin owner variable", async () => {
        expect(typeof factory.owner).to.equal("undefined");
    });

    it("02 createQryptSafe succeeds and hasQryptSafe returns true", async () => {
        expect(await factory.hasQryptSafe(owner.address)).to.be.true;
    });

    it("03 getQryptSafe returns a non-zero address after creation", async () => {
        const addr = await factory.getQryptSafe(owner.address);
        expect(addr).to.not.equal(ethers.ZeroAddress);
    });

    it("04 duplicate createQryptSafe reverts", async () => {
        await expect(factory.connect(owner).createQryptSafe(passwordHash))
            .to.be.revertedWith("QryptSafe already exists for this wallet");
    });

    it("05 factory emits QryptSafeCreated event on createQryptSafe", async () => {
        const Factory2 = await ethers.getContractFactory("contracts/QryptSafeV5.sol:QryptSafeV5");
        const f2 = await Factory2.deploy();
        const [, , , , , newUser] = await ethers.getSigners();
        await expect(f2.connect(newUser).createQryptSafe(passwordHash))
            .to.emit(f2, "QryptSafeCreated");
    });

    it("06 vault owner is set correctly after initialization", async () => {
        expect(await vault.owner()).to.equal(owner.address);
    });

    it("07 vault.initialized is true after createQryptSafe", async () => {
        expect(await vault.initialized()).to.be.true;
    });

    // ── GROUP 2: qrypt (8-14) ───────────────────────────────────────────────

    it("08 qrypt() deposits tokens and qToken balance increases", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(100), passwordHash);
        const bal = await vault.getQryptedBalance(await token.getAddress());
        expect(bal).to.equal(USDC(100));
    });

    it("09 qrypt() emits TokenQrypted event", async () => {
        await expect(vault.connect(owner).qrypt(await token.getAddress(), USDC(50), passwordHash))
            .to.emit(vault, "TokenQrypted");
    });

    it("10 qrypt() with wrong proof reverts Invalid vault proof", async () => {
        const wrongProof = ethers.keccak256(ethers.toUtf8Bytes("wrongpassword"));
        await expect(vault.connect(owner).qrypt(await token.getAddress(), USDC(10), wrongProof))
            .to.be.revertedWith("Invalid vault proof");
    });

    it("11 qrypt() from non-owner reverts Not QryptSafe owner", async () => {
        await token.mint(attacker.address, USDC(100));
        await token.connect(attacker).approve(await vault.getAddress(), ethers.MaxUint256);
        await expect(vault.connect(attacker).qrypt(await token.getAddress(), USDC(10), passwordHash))
            .to.be.revertedWith("Not QryptSafe owner");
    });

    it("12 qrypt() below minimum reverts Amount below minimum", async () => {
        await expect(vault.connect(owner).qrypt(await token.getAddress(), 999n, passwordHash))
            .to.be.revertedWith("Amount below minimum");
    });

    it("13 qrypt() twice accumulates qToken balance correctly", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(30), passwordHash);
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(20), passwordHash);
        expect(await vault.getQryptedBalance(await token.getAddress())).to.equal(USDC(50));
    });

    it("14 getQTokenAddress returns non-zero after first qrypt", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(10), passwordHash);
        const q = await vault.getQTokenAddress(await token.getAddress());
        expect(q).to.not.equal(ethers.ZeroAddress);
    });

    // ── GROUP 3: unqrypt (15-19) ────────────────────────────────────────────

    it("15 unqrypt() full balance returns all tokens to owner", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(100), passwordHash);
        const before = await token.balanceOf(owner.address);
        await vault.connect(owner).unqrypt(await token.getAddress(), USDC(100), passwordHash);
        expect(await token.balanceOf(owner.address)).to.equal(before + USDC(100));
    });

    it("16 unqrypt() partial balance leaves remainder", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(100), passwordHash);
        await vault.connect(owner).unqrypt(await token.getAddress(), USDC(40), passwordHash);
        expect(await vault.getQryptedBalance(await token.getAddress())).to.equal(USDC(60));
    });

    it("17 unqrypt() emits TokenUnqrypted event", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(20), passwordHash);
        await expect(vault.connect(owner).unqrypt(await token.getAddress(), USDC(20), passwordHash))
            .to.emit(vault, "TokenUnqrypted");
    });

    it("18 unqrypt() with wrong proof reverts Invalid vault proof", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(50), passwordHash);
        const wrongProof = ethers.keccak256(ethers.toUtf8Bytes("badproof"));
        await expect(vault.connect(owner).unqrypt(await token.getAddress(), USDC(50), wrongProof))
            .to.be.revertedWith("Invalid vault proof");
    });

    it("19 unqrypt() exceeding balance reverts Insufficient qrypted balance", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(10), passwordHash);
        await expect(vault.connect(owner).unqrypt(await token.getAddress(), USDC(99), passwordHash))
            .to.be.revertedWith("Insufficient qrypted balance");
    });

    // ── GROUP 4: rotateProof (20-23) ────────────────────────────────────────

    it("20 rotateProof accepts valid old proof and sets new hash", async () => {
        const newHash = ethers.keccak256(ethers.toUtf8Bytes("newproof123"));
        await vault.connect(owner).rotateProof(passwordHash, newHash);
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(10), newHash);
        expect(await vault.getQryptedBalance(await token.getAddress())).to.equal(USDC(10));
    });

    it("21 rotateProof emits ProofRotated event", async () => {
        const newHash = ethers.keccak256(ethers.toUtf8Bytes("newproof456"));
        await expect(vault.connect(owner).rotateProof(passwordHash, newHash))
            .to.emit(vault, "ProofRotated");
    });

    it("22 rotateProof with wrong old proof reverts", async () => {
        const wrongOld = ethers.keccak256(ethers.toUtf8Bytes("wrongold"));
        const newHash  = ethers.keccak256(ethers.toUtf8Bytes("newproof789"));
        await expect(vault.connect(owner).rotateProof(wrongOld, newHash))
            .to.be.revertedWith("Invalid current vault proof");
    });

    it("23 old proof invalid after rotateProof", async () => {
        const newHash = ethers.keccak256(ethers.toUtf8Bytes("brandnew"));
        await vault.connect(owner).rotateProof(passwordHash, newHash);
        await expect(vault.connect(owner).qrypt(await token.getAddress(), USDC(10), passwordHash))
            .to.be.revertedWith("Invalid vault proof");
    });

    // ── GROUP 5: Veil-Reveal (24-31) ────────────────────────────────────────

    it("24 veilTransfer() takes bytes32 hash only — no proofHash param", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(20), passwordHash);
        const veilHash = buildVeilHash(1n, await token.getAddress(), recipient.address, USDC(5));
        await expect(vault.connect(owner).veilTransfer(veilHash)).to.not.be.reverted;
    });

    it("25 veilTransfer() emits TransferVeiled event", async () => {
        const veilHash = buildVeilHash(2n, await token.getAddress(), recipient.address, USDC(5));
        await expect(vault.connect(owner).veilTransfer(veilHash))
            .to.emit(vault, "TransferVeiled");
    });

    it("26 duplicate veilTransfer reverts Veil already exists", async () => {
        const veilHash = buildVeilHash(3n, await token.getAddress(), recipient.address, USDC(5));
        await vault.connect(owner).veilTransfer(veilHash);
        await expect(vault.connect(owner).veilTransfer(veilHash))
            .to.be.revertedWith("Veil already exists");
    });

    it("27 unveilTransfer() succeeds after one block wait", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(20), passwordHash);
        const amount = USDC(5);
        const nonce  = 10n;
        const tokenAddr = await token.getAddress();
        const veilHash = buildVeilHash(nonce, tokenAddr, recipient.address, amount);
        await vault.connect(owner).veilTransfer(veilHash);
        await ethers.provider.send("evm_mine", []);
        await vault.connect(owner).unveilTransfer(tokenAddr, recipient.address, amount, passwordHash, nonce);
        expect(await token.balanceOf(recipient.address)).to.equal(amount);
    });

    it("28 unveilTransfer() wrong proof reverts Invalid vault proof", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(20), passwordHash);
        const amount = USDC(5);
        const nonce  = 11n;
        const tokenAddr = await token.getAddress();
        const veilHash = buildVeilHash(nonce, tokenAddr, recipient.address, amount);
        await vault.connect(owner).veilTransfer(veilHash);
        await ethers.provider.send("evm_mine", []);
        const wrongProof = ethers.keccak256(ethers.toUtf8Bytes("wrong"));
        await expect(vault.connect(owner).unveilTransfer(tokenAddr, recipient.address, amount, wrongProof, nonce))
            .to.be.revertedWith("Invalid vault proof");
    });

    it("29 unveilTransfer() with no veil reverts Veil not found", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(20), passwordHash);
        await expect(
            vault.connect(owner).unveilTransfer(await token.getAddress(), recipient.address, USDC(5), passwordHash, 999n)
        ).to.be.revertedWith("Veil not found");
    });

    it("30 unveilTransfer() replay reverts Veil already used", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(20), passwordHash);
        const amount = USDC(5);
        const nonce  = 12n;
        const tokenAddr = await token.getAddress();
        const veilHash = buildVeilHash(nonce, tokenAddr, recipient.address, amount);
        await vault.connect(owner).veilTransfer(veilHash);
        await ethers.provider.send("evm_mine", []);
        await vault.connect(owner).unveilTransfer(tokenAddr, recipient.address, amount, passwordHash, nonce);
        await expect(vault.connect(owner).unveilTransfer(tokenAddr, recipient.address, amount, passwordHash, nonce))
            .to.be.revertedWith("Veil already used");
    });

    it("31 unveilTransfer() emits TransferUnveiled event", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(20), passwordHash);
        const nonce = 13n;
        const tokenAddr = await token.getAddress();
        const amount = USDC(5);
        const veilHash = buildVeilHash(nonce, tokenAddr, recipient.address, amount);
        await vault.connect(owner).veilTransfer(veilHash);
        await ethers.provider.send("evm_mine", []);
        await expect(vault.connect(owner).unveilTransfer(tokenAddr, recipient.address, amount, passwordHash, nonce))
            .to.emit(vault, "TransferUnveiled");
    });

    // ── GROUP 6: QryptAir claimAirVoucher (32-39) ───────────────────────────

    it("32 claimAirVoucher() with valid EIP-712 sig transfers tokens", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(20), passwordHash);
        const amount    = USDC(5);
        const deadline  = BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600);
        const nonce     = ethers.randomBytes(32);
        const tcHash    = ethers.keccak256(ethers.toUtf8Bytes("code123"));
        const sig = await signAirVoucher(owner, await vault.getAddress(), await token.getAddress(), amount, recipient.address, deadline, nonce, tcHash);
        await vault.connect(relayer).claimAirVoucher(await token.getAddress(), amount, recipient.address, deadline, nonce, tcHash, sig);
        expect(await token.balanceOf(recipient.address)).to.equal(amount);
    });

    it("33 claimAirVoucher() emits AirVoucherClaimed event", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(10), passwordHash);
        const amount   = USDC(3);
        const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600);
        const nonce    = ethers.randomBytes(32);
        const tcHash   = ethers.keccak256(ethers.toUtf8Bytes("code456"));
        const sig = await signAirVoucher(owner, await vault.getAddress(), await token.getAddress(), amount, recipient.address, deadline, nonce, tcHash);
        await expect(vault.connect(relayer).claimAirVoucher(await token.getAddress(), amount, recipient.address, deadline, nonce, tcHash, sig))
            .to.emit(vault, "AirVoucherClaimed");
    });

    it("34 claimAirVoucher() expired deadline reverts Voucher expired", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(10), passwordHash);
        const amount      = USDC(3);
        const pastDeadline = BigInt((await ethers.provider.getBlock("latest")).timestamp - 1);
        const nonce       = ethers.randomBytes(32);
        const tcHash      = ethers.keccak256(ethers.toUtf8Bytes("expired"));
        const sig = await signAirVoucher(owner, await vault.getAddress(), await token.getAddress(), amount, recipient.address, pastDeadline, nonce, tcHash);
        await expect(vault.connect(relayer).claimAirVoucher(await token.getAddress(), amount, recipient.address, pastDeadline, nonce, tcHash, sig))
            .to.be.revertedWith("Voucher expired");
    });

    it("35 claimAirVoucher() replay reverts Voucher already redeemed", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(20), passwordHash);
        const amount   = USDC(3);
        const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600);
        const nonce    = ethers.randomBytes(32);
        const tcHash   = ethers.keccak256(ethers.toUtf8Bytes("nonce-replay"));
        const sig = await signAirVoucher(owner, await vault.getAddress(), await token.getAddress(), amount, recipient.address, deadline, nonce, tcHash);
        await vault.connect(relayer).claimAirVoucher(await token.getAddress(), amount, recipient.address, deadline, nonce, tcHash, sig);
        await expect(vault.connect(relayer).claimAirVoucher(await token.getAddress(), amount, recipient.address, deadline, nonce, tcHash, sig))
            .to.be.revertedWith("Voucher already redeemed");
    });

    it("36 claimAirVoucher() wrong signer reverts", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(10), passwordHash);
        const amount   = USDC(3);
        const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600);
        const nonce    = ethers.randomBytes(32);
        const tcHash   = ethers.keccak256(ethers.toUtf8Bytes("wrongsigner"));
        const sig = await signAirVoucher(attacker, await vault.getAddress(), await token.getAddress(), amount, recipient.address, deadline, nonce, tcHash);
        await expect(vault.connect(relayer).claimAirVoucher(await token.getAddress(), amount, recipient.address, deadline, nonce, tcHash, sig))
            .to.be.revertedWith("Sig not from vault owner");
    });

    it("37 claimAirVoucher() wrong transferCodeHash reverts", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(10), passwordHash);
        const amount   = USDC(3);
        const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600);
        const nonce    = ethers.randomBytes(32);
        const realCode = ethers.keccak256(ethers.toUtf8Bytes("realcode"));
        const wrongCode = ethers.keccak256(ethers.toUtf8Bytes("wrongcode"));
        const sig = await signAirVoucher(owner, await vault.getAddress(), await token.getAddress(), amount, recipient.address, deadline, nonce, realCode);
        await expect(vault.connect(relayer).claimAirVoucher(await token.getAddress(), amount, recipient.address, deadline, nonce, wrongCode, sig))
            .to.be.revertedWith("Sig not from vault owner");
    });

    it("38 usedVoucherNonces() returns true after redemption", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(10), passwordHash);
        const amount   = USDC(2);
        const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600);
        const nonce    = ethers.randomBytes(32);
        const tcHash   = ethers.keccak256(ethers.toUtf8Bytes("noncemark"));
        const sig = await signAirVoucher(owner, await vault.getAddress(), await token.getAddress(), amount, recipient.address, deadline, nonce, tcHash);
        await vault.connect(relayer).claimAirVoucher(await token.getAddress(), amount, recipient.address, deadline, nonce, tcHash, sig);
        expect(await vault.usedVoucherNonces(nonce)).to.be.true;
    });

    it("39 usedVoucherNonces() returns false before any redemption", async () => {
        const nonce = ethers.randomBytes(32);
        expect(await vault.usedVoucherNonces(nonce)).to.be.false;
    });

    // ── GROUP 7: railgun (40-43) ────────────────────────────────────────────

    it("40 railgun() burns qTokens and calls mock proxy", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(10), passwordHash);
        const before = await vault.getQryptedBalance(await token.getAddress());
        const [mockProxy] = await ethers.getSigners();
        await token.connect(owner).approve(await vault.getAddress(), ethers.MaxUint256);
        await vault.connect(owner).railgun(
            await token.getAddress(), USDC(1), passwordHash, mockProxy.address, "0x"
        );
        expect(await vault.getQryptedBalance(await token.getAddress())).to.equal(before - USDC(1));
    });

    it("41 railgun() with wrong proof reverts Invalid vault proof", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(10), passwordHash);
        const wrongProof = ethers.keccak256(ethers.toUtf8Bytes("wrong"));
        const [mockProxy] = await ethers.getSigners();
        await expect(
            vault.connect(owner).railgun(await token.getAddress(), USDC(1), wrongProof, mockProxy.address, "0x")
        ).to.be.revertedWith("Invalid vault proof");
    });

    it("42 railgun() with zero proxy reverts Invalid Railgun proxy", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(10), passwordHash);
        await expect(
            vault.connect(owner).railgun(await token.getAddress(), USDC(1), passwordHash, ethers.ZeroAddress, "0x")
        ).to.be.revertedWith("Invalid Railgun proxy");
    });

    it("43 railgun() emits TokenUnqrypted event", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(10), passwordHash);
        const [mockProxy] = await ethers.getSigners();
        await expect(
            vault.connect(owner).railgun(await token.getAddress(), USDC(1), passwordHash, mockProxy.address, "0x")
        ).to.emit(vault, "TokenUnqrypted");
    });

    // ── GROUP 8: Edge Cases & Security (44-51) ──────────────────────────────

    it("44 two QryptSafes for different users are independent", async () => {
        const [, , , , , user2] = await ethers.getSigners();
        await factory.connect(user2).createQryptSafe(passwordHash);
        const addr1 = await factory.getQryptSafe(owner.address);
        const addr2 = await factory.getQryptSafe(user2.address);
        expect(addr1).to.not.equal(addr2);
    });

    it("45 qToken is non-transferable between users", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(10), passwordHash);
        const qAddr = await vault.getQTokenAddress(await token.getAddress());
        const qToken = await ethers.getContractAt("ShieldToken", qAddr);
        await expect(qToken.connect(owner).transfer(attacker.address, USDC(1)))
            .to.be.reverted;
    });

    it("46 getQTokenAddress returns zero for never-qrypted token", async () => {
        expect(await vault.getQTokenAddress(await token2.getAddress())).to.equal(ethers.ZeroAddress);
    });

    it("47 getQryptedBalance returns zero for never-qrypted token", async () => {
        expect(await vault.getQryptedBalance(await token2.getAddress())).to.equal(0n);
    });

    it("48 emergencyWithdraw() requires no proofHash (V5) but enforces delay", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(10), passwordHash);
        await expect(vault.connect(owner).emergencyWithdraw([await token.getAddress()]))
            .to.be.revertedWith("Emergency withdraw not yet available");
    });

    it("49 getEmergencyWithdrawAvailableBlock returns a future block", async () => {
        const available = await vault.getEmergencyWithdrawAvailableBlock();
        const current   = BigInt(await ethers.provider.getBlockNumber());
        expect(available).to.be.gt(current);
    });

    it("50 vault cannot be initialized twice", async () => {
        await expect(vault.connect(owner).initialize(owner.address, passwordHash))
            .to.be.revertedWith("Already initialized");
    });

    it("51 unveilTransfer() must wait at least one block after veilTransfer", async () => {
        await vault.connect(owner).qrypt(await token.getAddress(), USDC(20), passwordHash);
        const nonce = 51n;
        const tokenAddr = await token.getAddress();
        const amount = USDC(1);
        const veilHash = buildVeilHash(nonce, tokenAddr, recipient.address, amount);

        // Get on-chain nonce before disabling automine
        const ownerNonce = await ethers.provider.getTransactionCount(owner.address, "latest");

        // Disable automine so both txs land in the same block
        await ethers.provider.send("evm_setAutomine", [false]);

        // Submit both txs with sequential explicit nonces (both go to pending mempool)
        await vault.connect(owner).veilTransfer(veilHash,
            { nonce: ownerNonce, gasLimit: 150000 });
        const unveilTx = await vault.connect(owner).unveilTransfer(
            tokenAddr, recipient.address, amount, passwordHash, nonce,
            { nonce: ownerNonce + 1, gasLimit: 200000 }
        );

        // Mine both txs in the same block
        await ethers.provider.send("evm_mine", []);
        await ethers.provider.send("evm_setAutomine", [true]);

        // unveilTransfer ran in same block as veilTransfer → block.number == veil.blockNumber
        // → "Must wait one block after veil" revert
        const receipt = await ethers.provider.getTransactionReceipt(unveilTx.hash);
        expect(receipt).to.not.be.null;
        expect(receipt.status).to.equal(0); // 0 = reverted
    });
});
