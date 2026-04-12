const { expect } = require("chai");
const { ethers }  = require("hardhat");
const { time }    = require("@nomicfoundation/hardhat-network-helpers");

describe("QryptSafeV3", function () {
    let factory, vault, token, owner, attacker, recipient, relayer;
    const VAULT_PROOF = "abc123";
    let passwordHash, proofBytes;

    const USDC = (n) => ethers.parseUnits(String(n), 6);

    // Build EIP-712 meta-transfer signature
    async function signMetaTransfer(signer, vaultAddr, tokenAddr, to, amount, nonce, deadline) {
        const domain = {
            name:              "QryptSafe",
            version:           "3",
            chainId:           (await ethers.provider.getNetwork()).chainId,
            verifyingContract: vaultAddr,
        };
        const types = {
            MetaTransfer: [
                { name: "token",    type: "address" },
                { name: "to",       type: "address" },
                { name: "amount",   type: "uint256" },
                { name: "nonce",    type: "uint256" },
                { name: "deadline", type: "uint256" },
            ],
        };
        const value = { token: tokenAddr, to, amount, nonce, deadline };
        return signer.signTypedData(domain, types, value);
    }

    beforeEach(async () => {
        [owner, attacker, recipient, relayer] = await ethers.getSigners();
        proofBytes   = ethers.zeroPadBytes(ethers.toUtf8Bytes(VAULT_PROOF), 32);
        passwordHash = ethers.keccak256(proofBytes);

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        token = await MockERC20.deploy("USD Coin", "USDC", 6);

        const Factory = await ethers.getContractFactory("QryptSafeV3");
        factory = await Factory.deploy();

        await factory.connect(owner).createVault(passwordHash);
        const vaultAddr = await factory.getVault(owner.address);
        vault = await ethers.getContractAt("PersonalQryptSafeV3", vaultAddr);

        await token.mint(owner.address, USDC(10_000));
        await token.connect(owner).approve(vaultAddr, ethers.MaxUint256);
    });

    // ── Factory: no Ownable (V3 trustless) ──────────────────────────────────

    it("V3: factory has no owner() function", async () => {
        expect(typeof factory.owner).to.equal("undefined");
    });

    it("V3: MINIMUM_SHIELD_AMOUNT is an immutable constant (1e6)", async () => {
        expect(await factory.MINIMUM_SHIELD_AMOUNT()).to.equal(1_000_000n);
    });

    it("V3: factory has no setMinShieldAmount function", async () => {
        expect(typeof factory.setMinShieldAmount).to.equal("undefined");
    });

    it("creates vault and records it", async () => {
        expect(await factory.hasVault(owner.address)).to.be.true;
    });

    it("prevents duplicate vault for same wallet", async () => {
        await expect(factory.connect(owner).createVault(passwordHash))
            .to.be.revertedWith("Vault already exists for this wallet");
    });

    it("multiple different wallets can each create a vault", async () => {
        const proof2 = ethers.keccak256(ethers.zeroPadBytes(ethers.toUtf8Bytes("xyz789"), 32));
        await factory.connect(attacker).createVault(proof2);
        expect(await factory.hasVault(attacker.address)).to.be.true;
        expect(await factory.getVault(attacker.address)).to.not.equal(await factory.getVault(owner.address));
    });

    it("factory getVault returns vault address for owner", async () => {
        expect(await factory.getVault(owner.address)).to.not.equal(ethers.ZeroAddress);
    });

    // ── Shield ───────────────────────────────────────────────────────────────

    it("shields tokens and mints qTokens", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes);
        expect(await vault.getShieldedBalance(await token.getAddress())).to.equal(USDC(100));
    });

    it("rejects shield below minimum (< 1e6)", async () => {
        await expect(vault.connect(owner).shield(await token.getAddress(), 999_999n, proofBytes))
            .to.be.revertedWith("Amount below minimum");
    });

    it("rejects shield with wrong vault proof", async () => {
        const wrong = ethers.zeroPadBytes(ethers.toUtf8Bytes("wrong9"), 32);
        await expect(vault.connect(owner).shield(await token.getAddress(), USDC(100), wrong))
            .to.be.revertedWith("Invalid vault proof");
    });

    it("rejects shield from non-owner", async () => {
        await expect(vault.connect(attacker).shield(await token.getAddress(), USDC(100), proofBytes))
            .to.be.revertedWith("Not vault owner");
    });

    it("shields accumulate correctly across multiple calls", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes);
        await vault.connect(owner).shield(await token.getAddress(), USDC(50), proofBytes);
        expect(await vault.getShieldedBalance(await token.getAddress())).to.equal(USDC(150));
    });

    it("shields multiple token types independently", async () => {
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const token2 = await MockERC20.deploy("Tether", "USDT", 6);
        const vaultAddr = await factory.getVault(owner.address);
        await token2.mint(owner.address, USDC(500));
        await token2.connect(owner).approve(vaultAddr, ethers.MaxUint256);
        await vault.connect(owner).shield(await token.getAddress(),  USDC(100), proofBytes);
        await vault.connect(owner).shield(await token2.getAddress(), USDC(200), proofBytes);
        expect(await vault.getShieldedBalance(await token.getAddress())).to.equal(USDC(100));
        expect(await vault.getShieldedBalance(await token2.getAddress())).to.equal(USDC(200));
    });

    it("getQTokenAddress returns non-zero after first shield", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes);
        expect(await vault.getQTokenAddress(await token.getAddress())).to.not.equal(ethers.ZeroAddress);
    });

    it("qToken is non-transferable (soulbound)", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes);
        const qAddr  = await vault.getQTokenAddress(await token.getAddress());
        const qToken = await ethers.getContractAt("ShieldToken", qAddr);
        await expect(qToken.connect(owner).transfer(attacker.address, 1000n)).to.be.reverted;
    });

    // ── Unshield ─────────────────────────────────────────────────────────────

    it("unshields full balance correctly", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes);
        await vault.connect(owner).unshield(await token.getAddress(), USDC(100), proofBytes);
        expect(await vault.getShieldedBalance(await token.getAddress())).to.equal(0n);
    });

    it("unshields partial balance correctly", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes);
        await vault.connect(owner).unshield(await token.getAddress(), USDC(40), proofBytes);
        expect(await vault.getShieldedBalance(await token.getAddress())).to.equal(USDC(60));
    });

    it("rejects unshield exceeding shielded balance", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes);
        await expect(vault.connect(owner).unshield(await token.getAddress(), USDC(200), proofBytes))
            .to.be.revertedWith("Insufficient shielded balance");
    });

    // ── Commit-reveal ─────────────────────────────────────────────────────────

    it("commit stores correctly with nonce", async () => {
        const h = ethers.keccak256(ethers.toUtf8Bytes("tx-001"));
        await vault.connect(owner).commit(h, proofBytes);
    });

    it("duplicate commit is rejected (V2 replay fix kept)", async () => {
        const h = ethers.keccak256(ethers.toUtf8Bytes("tx-dup"));
        await vault.connect(owner).commit(h, proofBytes);
        await expect(vault.connect(owner).commit(h, proofBytes))
            .to.be.revertedWith("Commit already exists");
    });

    it("reveal transfers tokens to recipient", async () => {
        const amount = USDC(50);
        await vault.connect(owner).shield(await token.getAddress(), amount, proofBytes);
        const h = ethers.keccak256(ethers.toUtf8Bytes("tx-reveal"));
        await vault.connect(owner).commit(h, proofBytes);
        await vault.connect(owner).reveal(await token.getAddress(), recipient.address, amount, proofBytes, h);
        expect(await token.balanceOf(recipient.address)).to.equal(amount);
    });

    it("reveal rejects used commit", async () => {
        const amount = USDC(50);
        await vault.connect(owner).shield(await token.getAddress(), amount * 2n, proofBytes);
        const h = ethers.keccak256(ethers.toUtf8Bytes("tx-used"));
        await vault.connect(owner).commit(h, proofBytes);
        await vault.connect(owner).reveal(await token.getAddress(), recipient.address, amount, proofBytes, h);
        await expect(vault.connect(owner).reveal(await token.getAddress(), recipient.address, amount, proofBytes, h))
            .to.be.revertedWith("Commit already used");
    });

    it("reveal rejects nonexistent commit", async () => {
        const fake = ethers.keccak256(ethers.toUtf8Bytes("fake"));
        await expect(vault.connect(owner).reveal(await token.getAddress(), recipient.address, USDC(1), proofBytes, fake))
            .to.be.revertedWith("Commit not found");
    });

    // ── V3: changeVaultProof ─────────────────────────────────────────────────

    it("V3: changeVaultProof updates the password hash", async () => {
        const newProof    = "xyz789";
        const newBytes    = ethers.zeroPadBytes(ethers.toUtf8Bytes(newProof), 32);
        const newHash     = ethers.keccak256(newBytes);
        await vault.connect(owner).changeVaultProof(newHash, proofBytes);
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), newBytes);
        expect(await vault.getShieldedBalance(await token.getAddress())).to.equal(USDC(100));
    });

    it("V3: changeVaultProof requires correct current proof", async () => {
        const newHash  = ethers.keccak256(ethers.toUtf8Bytes("any"));
        const wrongPrf = ethers.zeroPadBytes(ethers.toUtf8Bytes("wrong9"), 32);
        await expect(vault.connect(owner).changeVaultProof(newHash, wrongPrf))
            .to.be.revertedWith("Invalid vault proof");
    });

    it("V3: old proof rejected after changeVaultProof", async () => {
        const newBytes = ethers.zeroPadBytes(ethers.toUtf8Bytes("xyz789"), 32);
        const newHash  = ethers.keccak256(newBytes);
        await vault.connect(owner).changeVaultProof(newHash, proofBytes);
        await expect(vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes))
            .to.be.revertedWith("Invalid vault proof");
    });

    it("V3: changeVaultProof emits ProofChanged event", async () => {
        const newHash = ethers.keccak256(ethers.zeroPadBytes(ethers.toUtf8Bytes("xyz789"), 32));
        await expect(vault.connect(owner).changeVaultProof(newHash, proofBytes))
            .to.emit(vault, "ProofChanged");
    });

    it("V3: changeVaultProof rejects zero newPasswordHash", async () => {
        await expect(vault.connect(owner).changeVaultProof(ethers.ZeroHash, proofBytes))
            .to.be.revertedWith("Invalid new proof hash");
    });

    // ── V3: ECDSA meta-transfer ───────────────────────────────────────────────

    it("V3: metaTransfer executes signed transfer via relayer", async () => {
        const amount   = USDC(50);
        await vault.connect(owner).shield(await token.getAddress(), amount, proofBytes);
        const vaultAddr = await factory.getVault(owner.address);
        const tokenAddr = await token.getAddress();
        const nonce     = 1n;
        const deadline  = BigInt(Math.floor(Date.now() / 1000) + 3600);
        const sig = await signMetaTransfer(owner, vaultAddr, tokenAddr, recipient.address, amount, nonce, deadline);
        await vault.connect(relayer).metaTransfer(tokenAddr, recipient.address, amount, nonce, deadline, sig);
        expect(await token.balanceOf(recipient.address)).to.equal(amount);
    });

    it("V3: metaTransfer rejects expired deadline", async () => {
        const amount   = USDC(50);
        await vault.connect(owner).shield(await token.getAddress(), amount, proofBytes);
        const vaultAddr = await factory.getVault(owner.address);
        const tokenAddr = await token.getAddress();
        const nonce     = 2n;
        const deadline  = BigInt(Math.floor(Date.now() / 1000) - 1);
        const sig = await signMetaTransfer(owner, vaultAddr, tokenAddr, recipient.address, amount, nonce, deadline);
        await expect(vault.connect(relayer).metaTransfer(tokenAddr, recipient.address, amount, nonce, deadline, sig))
            .to.be.revertedWith("Meta-transfer expired");
    });

    it("V3: metaTransfer rejects replay (nonce reuse)", async () => {
        const amount    = USDC(30);
        await vault.connect(owner).shield(await token.getAddress(), amount * 2n, proofBytes);
        const vaultAddr = await factory.getVault(owner.address);
        const tokenAddr = await token.getAddress();
        const nonce     = 3n;
        const deadline  = BigInt(Math.floor(Date.now() / 1000) + 3600);
        const sig = await signMetaTransfer(owner, vaultAddr, tokenAddr, recipient.address, amount, nonce, deadline);
        await vault.connect(relayer).metaTransfer(tokenAddr, recipient.address, amount, nonce, deadline, sig);
        await expect(vault.connect(relayer).metaTransfer(tokenAddr, recipient.address, amount, nonce, deadline, sig))
            .to.be.revertedWith("Nonce already used");
    });

    it("V3: metaTransfer rejects signature from wrong signer", async () => {
        const amount    = USDC(50);
        await vault.connect(owner).shield(await token.getAddress(), amount, proofBytes);
        const vaultAddr = await factory.getVault(owner.address);
        const tokenAddr = await token.getAddress();
        const nonce     = 4n;
        const deadline  = BigInt(Math.floor(Date.now() / 1000) + 3600);
        const sig = await signMetaTransfer(attacker, vaultAddr, tokenAddr, recipient.address, amount, nonce, deadline);
        await expect(vault.connect(relayer).metaTransfer(tokenAddr, recipient.address, amount, nonce, deadline, sig))
            .to.be.revertedWith("Invalid signature");
    });

    // ── Emergency & misc ─────────────────────────────────────────────────────

    it("emergency withdraw enforces delay", async () => {
        await vault.connect(owner).shield(await token.getAddress(), USDC(100), proofBytes);
        await expect(vault.connect(owner).emergencyWithdraw([await token.getAddress()], proofBytes))
            .to.be.revertedWith("Emergency delay not met");
    });

    it("vault cannot be initialized twice", async () => {
        await expect(vault.connect(owner).initialize(owner.address, passwordHash))
            .to.be.revertedWith("Already initialized");
    });

    it("V3: metaTransfer rejects when token not yet shielded", async () => {
        const vaultAddr = await factory.getVault(owner.address);
        const tokenAddr = await token.getAddress();
        const nonce     = 99n;
        const deadline  = BigInt(Math.floor(Date.now() / 1000) + 3600);
        const sig = await signMetaTransfer(owner, vaultAddr, tokenAddr, recipient.address, USDC(50), nonce, deadline);
        await expect(vault.connect(relayer).metaTransfer(tokenAddr, recipient.address, USDC(50), nonce, deadline, sig))
            .to.be.revertedWith("Token not shielded");
    });

    it("V3: VaultCreated event emitted on createVault", async () => {
        const proof2 = ethers.keccak256(ethers.zeroPadBytes(ethers.toUtf8Bytes("zzz999"), 32));
        await expect(factory.connect(recipient).createVault(proof2))
            .to.emit(factory, "VaultCreated");
    });
});
