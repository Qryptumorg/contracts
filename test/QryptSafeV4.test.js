const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("QryptSafeV4", function () {
    let factory, vault, token, token2, owner, attacker, recipient, relayer;
    const VAULT_PROOF = "mno345";
    let passwordHash, proofBytes;

    const USDC = (n) => ethers.parseUnits(String(n), 6);

    beforeEach(async () => {
        [, owner, attacker, recipient, relayer] = await ethers.getSigners();
        proofBytes   = ethers.zeroPadBytes(ethers.toUtf8Bytes(VAULT_PROOF), 32);
        passwordHash = ethers.keccak256(proofBytes);

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        token  = await MockERC20.deploy("USD Coin", "USDC", 6);
        token2 = await MockERC20.deploy("Tether",   "USDT", 6);

        const Factory = await ethers.getContractFactory("QryptSafeV4");
        factory = await Factory.deploy();
        await factory.connect(owner).createVault(passwordHash);
        const vaultAddr = await factory.getVault(owner.address);
        vault = await ethers.getContractAt("PersonalQryptSafeV4", vaultAddr);

        await token.mint(owner.address,  USDC(10_000));
        await token2.mint(owner.address, USDC(10_000));
        await token.connect(owner).approve(vaultAddr,  ethers.MaxUint256);
        await token2.connect(owner).approve(vaultAddr, ethers.MaxUint256);
    });

    // ── GROUP 1: Factory & Vault (1-7) ─────────────────────────────────────

    it("01 factory has no owner or pause", async () => {
        expect(typeof factory.owner).to.equal("undefined");
    });

    it("02 factory stores vaultCreatedAt block", async () => {
        expect(await factory.vaultCreatedAt(owner.address)).to.be.gt(0);
    });

    it("03 createVault succeeds and hasVault returns true", async () => {
        expect(await factory.hasVault(owner.address)).to.be.true;
    });

    it("04 duplicate vault reverts with custom error VaultAlreadyExists", async () => {
        await expect(factory.connect(owner).createVault(passwordHash))
            .to.be.revertedWithCustomError(factory, "VaultAlreadyExists");
    });

    it("05 vault stores createdAtBlock on init", async () => {
        expect(await vault.createdAtBlock()).to.be.gt(0);
    });

    it("06 activityCount starts at zero before any action", async () => {
        const [,, user2] = await ethers.getSigners();
        const ph2 = ethers.keccak256(ethers.zeroPadBytes(ethers.toUtf8Bytes("xyz999"), 32));
        await factory.connect(user2).createVault(ph2);
        const v2 = await ethers.getContractAt("PersonalQryptSafeV4", await factory.getVault(user2.address));
        expect(await v2.activityCount()).to.equal(0);
    });

    it("07 factory emits VaultCreated event on createVault", async () => {
        const [,, user2] = await ethers.getSigners();
        const ph2 = ethers.keccak256(ethers.zeroPadBytes(ethers.toUtf8Bytes("proof-u2"), 32));
        await expect(factory.connect(user2).createVault(ph2))
            .to.emit(factory, "VaultCreated");
    });

    // ── GROUP 2: Shield & Unshield (8-17) ──────────────────────────────────

    it("08 shields tokens and shielded balance updates", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes);
        expect(await vault.getShieldedBalance(await token.getAddress())).to.equal(USDC(100));
    });

    it("09 shield emits TokenShielded event", async () => {
        await expect(vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes))
            .to.emit(vault, "TokenShielded");
    });

    it("10 shield increments activityCount", async () => {
        const before = await vault.activityCount();
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes);
        expect(await vault.activityCount()).to.equal(before + 1n);
    });

    it("11 rejects shield below minimum with InvalidAmount", async () => {
        await expect(vault.connect(owner).shield(await token.getAddress(), 100, proofBytes))
            .to.be.revertedWithCustomError(vault, "InvalidAmount");
    });

    it("12 rejects shield with wrong proof with InvalidProof", async () => {
        const bad = ethers.zeroPadBytes(ethers.toUtf8Bytes("wrong1"), 32);
        await expect(vault.connect(owner).shield(await token.getAddress(), USDC(100), bad))
            .to.be.revertedWithCustomError(vault, "InvalidProof");
    });

    it("13 rejects shield from non-owner with NotOwner", async () => {
        await expect(vault.connect(attacker).shield(await token.getAddress(), USDC(100), proofBytes))
            .to.be.revertedWithCustomError(vault, "NotOwner");
    });

    it("14 unshields full balance and balance returns to zero", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes);
        await vault.connect(owner).unshield(await token.getAddress(), USDC(100), proofBytes);
        expect(await vault.getShieldedBalance(await token.getAddress())).to.equal(0);
    });

    it("15 unshields partial balance (V4 feature)", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes);
        await vault.connect(owner).unshield(await token.getAddress(), USDC(40), proofBytes);
        expect(await vault.getShieldedBalance(await token.getAddress())).to.equal(USDC(60));
    });

    it("16 rejects unshield exceeding balance with InsufficientBalance", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes);
        await expect(vault.connect(owner).unshield(await token.getAddress(), USDC(999), proofBytes))
            .to.be.revertedWithCustomError(vault, "InsufficientBalance");
    });

    it("17 rejects unshield with wrong proof with InvalidProof", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes);
        const bad = ethers.zeroPadBytes(ethers.toUtf8Bytes("wrong1"), 32);
        await expect(vault.connect(owner).unshield(await token.getAddress(), USDC(1), bad))
            .to.be.revertedWithCustomError(vault, "InvalidProof");
    });

    // ── GROUP 3: Proof & Commit-Reveal (18-27) ──────────────────────────────

    it("18 changeVaultProof accepts valid old proof and new hash", async () => {
        const newProof = "pqr678";
        const newBytes = ethers.zeroPadBytes(ethers.toUtf8Bytes(newProof), 32);
        const newHash  = ethers.keccak256(newBytes);
        await vault.connect(owner).changeVaultProof(proofBytes, newHash);
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), newBytes);
    });

    it("19 rejects changeVaultProof with wrong old proof", async () => {
        const bad = ethers.zeroPadBytes(ethers.toUtf8Bytes("wrong1"), 32);
        await expect(vault.connect(owner).changeVaultProof(bad, ethers.keccak256(ethers.toUtf8Bytes("new"))))
            .to.be.revertedWithCustomError(vault, "InvalidProof");
    });

    it("20 rejects changeVaultProof with zero new hash", async () => {
        await expect(vault.connect(owner).changeVaultProof(proofBytes, ethers.ZeroHash))
            .to.be.revertedWithCustomError(vault, "InvalidNewProof");
    });

    it("21 old proof invalid after changeVaultProof", async () => {
        const newHash = ethers.keccak256(ethers.zeroPadBytes(ethers.toUtf8Bytes("pqr678"), 32));
        await vault.connect(owner).changeVaultProof(proofBytes, newHash);
        await expect(vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes))
            .to.be.revertedWithCustomError(vault, "InvalidProof");
    });

    it("22 changeVaultProof increments activityCount", async () => {
        const before = await vault.activityCount();
        const newHash = ethers.keccak256(ethers.zeroPadBytes(ethers.toUtf8Bytes("pqr678"), 32));
        await vault.connect(owner).changeVaultProof(proofBytes, newHash);
        expect(await vault.activityCount()).to.be.gt(before);
    });

    it("23 commit-reveal full flow works", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(50), proofBytes);
        const h = ethers.keccak256(ethers.toUtf8Bytes("v4-commit"));
        await vault.connect(owner).commit(h, proofBytes);
        await vault.connect(owner).reveal(await token.getAddress(), recipient.address, USDC(50), proofBytes, h);
        expect(await token.balanceOf(recipient.address)).to.equal(USDC(50));
    });

    it("24 duplicate commit reverts with CommitExists", async () => {
        const h = ethers.keccak256(ethers.toUtf8Bytes("dup-v4"));
        await vault.connect(owner).commit(h, proofBytes);
        await expect(vault.connect(owner).commit(h, proofBytes))
            .to.be.revertedWithCustomError(vault, "CommitExists");
    });

    it("25 reveal used commit reverts with CommitUsed", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes);
        const h = ethers.keccak256(ethers.toUtf8Bytes("used-v4"));
        await vault.connect(owner).commit(h, proofBytes);
        await vault.connect(owner).reveal(await token.getAddress(), recipient.address, USDC(50), proofBytes, h);
        await expect(vault.connect(owner).reveal(await token.getAddress(), recipient.address, USDC(50), proofBytes, h))
            .to.be.revertedWithCustomError(vault, "CommitUsed");
    });

    it("26 reveal nonexistent commit reverts with CommitNotFound", async () => {
        await expect(vault.connect(owner).reveal(await token.getAddress(), recipient.address, USDC(1), proofBytes, ethers.ZeroHash))
            .to.be.revertedWithCustomError(vault, "CommitNotFound");
    });

    it("27 commit increments activityCount", async () => {
        const before = await vault.activityCount();
        const h = ethers.keccak256(ethers.toUtf8Bytes("commit-count"));
        await vault.connect(owner).commit(h, proofBytes);
        expect(await vault.activityCount()).to.be.gt(before);
    });

    // ── GROUP 4: metaTransfer / Multi-token / qToken (28-36) ───────────────

    it("28 metaTransfer with valid signature transfers funds", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(30), proofBytes);
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
        const sigNonce = ethers.keccak256(ethers.toUtf8Bytes("v4-nonce-1"));
        const msgHash  = ethers.keccak256(ethers.solidityPacked(
            ["address","address","uint256","uint256","bytes32"],
            [await token.getAddress(), recipient.address, USDC(30), deadline, sigNonce]
        ));
        const sig = await owner.signMessage(ethers.getBytes(msgHash));
        await vault.connect(relayer).metaTransfer(await token.getAddress(), recipient.address, USDC(30), deadline, sigNonce, sig);
        expect(await token.balanceOf(recipient.address)).to.equal(USDC(30));
    });

    it("29 metaTransfer expired deadline reverts with SignatureExpired", async () => {
        const deadline = (await ethers.provider.getBlock("latest")).timestamp - 1;
        const sigNonce = ethers.keccak256(ethers.toUtf8Bytes("exp"));
        const msgHash  = ethers.keccak256(ethers.solidityPacked(
            ["address","address","uint256","uint256","bytes32"],
            [await token.getAddress(), recipient.address, USDC(1), deadline, sigNonce]
        ));
        const sig = await owner.signMessage(ethers.getBytes(msgHash));
        await expect(vault.connect(relayer).metaTransfer(await token.getAddress(), recipient.address, USDC(1), deadline, sigNonce, sig))
            .to.be.revertedWithCustomError(vault, "SignatureExpired");
    });

    it("30 metaTransfer wrong signer reverts with InvalidSignature", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(30), proofBytes);
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
        const sigNonce = ethers.keccak256(ethers.toUtf8Bytes("v4-bad"));
        const msgHash  = ethers.keccak256(ethers.solidityPacked(
            ["address","address","uint256","uint256","bytes32"],
            [await token.getAddress(), recipient.address, USDC(30), deadline, sigNonce]
        ));
        const sig = await attacker.signMessage(ethers.getBytes(msgHash));
        await expect(vault.connect(relayer).metaTransfer(await token.getAddress(), recipient.address, USDC(30), deadline, sigNonce, sig))
            .to.be.revertedWithCustomError(vault, "InvalidSignature");
    });

    it("31 metaTransfer replay reverts with SignatureUsed", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(60), proofBytes);
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
        const sigNonce = ethers.keccak256(ethers.toUtf8Bytes("v4-replay"));
        const msgHash  = ethers.keccak256(ethers.solidityPacked(
            ["address","address","uint256","uint256","bytes32"],
            [await token.getAddress(), recipient.address, USDC(30), deadline, sigNonce]
        ));
        const sig = await owner.signMessage(ethers.getBytes(msgHash));
        await vault.connect(relayer).metaTransfer(await token.getAddress(), recipient.address, USDC(30), deadline, sigNonce, sig);
        await expect(vault.connect(relayer).metaTransfer(await token.getAddress(), recipient.address, USDC(30), deadline, sigNonce, sig))
            .to.be.revertedWithCustomError(vault, "SignatureUsed");
    });

    it("32 metaTransfer increments activityCount", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(30), proofBytes);
        const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
        const sigNonce = ethers.keccak256(ethers.toUtf8Bytes("v4-count"));
        const msgHash  = ethers.keccak256(ethers.solidityPacked(
            ["address","address","uint256","uint256","bytes32"],
            [await token.getAddress(), recipient.address, USDC(30), deadline, sigNonce]
        ));
        const sig = await owner.signMessage(ethers.getBytes(msgHash));
        const before = await vault.activityCount();
        await vault.connect(relayer).metaTransfer(await token.getAddress(), recipient.address, USDC(30), deadline, sigNonce, sig);
        expect(await vault.activityCount()).to.be.gt(before);
    });

    it("33 shields two tokens independently", async () => {
        await vault.connect(owner).shield(await token.getAddress(),  USDC(100), proofBytes);
        await vault.connect(owner).shield(await token2.getAddress(), USDC(200), proofBytes);
        expect(await vault.getShieldedBalance(await token.getAddress())).to.equal(USDC(100));
        expect(await vault.getShieldedBalance(await token2.getAddress())).to.equal(USDC(200));
    });

    it("34 unshields two tokens independently without cross-contamination", async () => {
        await vault.connect(owner).shield(await token.getAddress(),  USDC(100), proofBytes);
        await vault.connect(owner).shield(await token2.getAddress(), USDC(200), proofBytes);
        await vault.connect(owner).unshield(await token.getAddress(), USDC(100), proofBytes);
        expect(await vault.getShieldedBalance(await token.getAddress())).to.equal(0);
        expect(await vault.getShieldedBalance(await token2.getAddress())).to.equal(USDC(200));
    });

    it("35 qToken is non-transferable", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes);
        const qAddr  = await vault.getQTokenAddress(await token.getAddress());
        const qToken = await ethers.getContractAt("ShieldToken", qAddr);
        await expect(qToken.connect(owner).transfer(attacker.address, 1000)).to.be.reverted;
    });

    it("36 getQTokenAddress returns zero for unshielded token", async () => {
        expect(await vault.getQTokenAddress(await token.getAddress())).to.equal(ethers.ZeroAddress);
    });

    // ── GROUP 5: Emergency & Edge Cases (37-47) ─────────────────────────────

    it("37 emergency withdraw enforces delay with EmergencyDelayNotMet", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes);
        await expect(vault.connect(owner).emergencyWithdraw([await token.getAddress()], proofBytes))
            .to.be.revertedWithCustomError(vault, "EmergencyDelayNotMet");
    });

    it("38 getEmergencyWithdrawAvailableBlock is in the future", async () => {
        const current   = await ethers.provider.getBlockNumber();
        const available = await vault.getEmergencyWithdrawAvailableBlock();
        expect(available).to.be.gt(current);
    });

    it("39 getShieldedBalance returns zero for never-shielded token", async () => {
        expect(await vault.getShieldedBalance(await token.getAddress())).to.equal(0);
    });

    it("40 second vault for different user is independent", async () => {
        const [,, user2] = await ethers.getSigners();
        const ph2 = ethers.keccak256(ethers.zeroPadBytes(ethers.toUtf8Bytes("xyz999"), 32));
        await factory.connect(user2).createVault(ph2);
        expect(await factory.hasVault(user2.address)).to.be.true;
        expect(await factory.getVault(user2.address)).to.not.equal(await factory.getVault(owner.address));
    });

    it("41 hasVault returns false for address with no vault", async () => {
        const [,,,, stranger] = await ethers.getSigners();
        expect(await factory.hasVault(stranger.address)).to.be.false;
    });

    it("42 factory vaultCreatedAt returns positive block number", async () => {
        expect(await factory.vaultCreatedAt(owner.address)).to.be.gt(0);
    });

    it("43 createdAtBlock is lte current block number", async () => {
        const current = await ethers.provider.getBlockNumber();
        expect(await vault.createdAtBlock()).to.be.lte(current);
    });

    it("44 unshield emits TokenUnshielded event", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes);
        await expect(vault.connect(owner).unshield(await token.getAddress(), USDC(50), proofBytes))
            .to.emit(vault, "TokenUnshielded");
    });

    it("45 unshield increments activityCount", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes);
        const before = await vault.activityCount();
        await vault.connect(owner).unshield(await token.getAddress(), USDC(50), proofBytes);
        expect(await vault.activityCount()).to.be.gt(before);
    });

    it("46 reveal increments activityCount", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes);
        const h = ethers.keccak256(ethers.toUtf8Bytes("reveal-count"));
        await vault.connect(owner).commit(h, proofBytes);
        const before = await vault.activityCount();
        await vault.connect(owner).reveal(await token.getAddress(), recipient.address, USDC(10), proofBytes, h);
        expect(await vault.activityCount()).to.be.gt(before);
    });

    it("47 getQTokenAddress returns zero for completely new token", async () => {
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const token3 = await MockERC20.deploy("Dai", "DAI", 18);
        expect(await vault.getQTokenAddress(await token3.getAddress())).to.equal(ethers.ZeroAddress);
    });
});
