const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// ── OTP Chain helpers (mirrors frontend password.ts logic) ────────────────
// H0 = keccak256(vaultProof), H1 = keccak256(H0), ... H100 = keccak256(H99)
// Contract stores H100. First proof used is H99. Then H98, etc.

function buildChain(vaultProof, depth = 100) {
    const chain = new Array(depth + 1);
    chain[0] = ethers.keccak256(ethers.toUtf8Bytes(vaultProof));
    for (let i = 1; i <= depth; i++) {
        chain[i] = ethers.keccak256(chain[i - 1]);
    }
    return chain; // chain[100] = H100 (goes to contract), chain[99] = first proof
}

// ── Test Suite ────────────────────────────────────────────────────────────

describe("QryptSafeV6", function () {
    let factory;
    let vault;
    let token;
    let owner;
    let attacker;
    let recipient;

    const VAULT_PROOF = "abc123";
    const CHAIN_DEPTH = 100;
    let chain; // chain[0]=H0, chain[100]=H100

    const SHIELD_AMOUNT = 1_000_000n;
    const GAS_OPTS = {};

    async function deployMockERC20(signer) {
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const t = await MockERC20.connect(signer).deploy("USD Coin", "USDC", 6);
        await t.waitForDeployment();
        return t;
    }

    beforeEach(async function () {
        [owner, attacker, recipient] = await ethers.getSigners();

        chain = buildChain(VAULT_PROOF, CHAIN_DEPTH);

        const Factory = await ethers.getContractFactory("contracts/QryptSafeV6.sol:QryptSafeV6");
        factory = await Factory.connect(owner).deploy();
        await factory.waitForDeployment();

        await factory.connect(owner).createQryptSafe(chain[CHAIN_DEPTH]);
        const vaultAddress = await factory.getQryptSafe(owner.address);
        vault = await ethers.getContractAt("PersonalQryptSafeV6", vaultAddress);

        token = await deployMockERC20(owner);
        await token.connect(owner).mint(owner.address, ethers.parseUnits("100000", 6));
        await token.connect(owner).approve(await vault.getAddress(), ethers.MaxUint256);
    });

    // ── Initialization ────────────────────────────────────────────────────

    describe("Initialization", function () {
        it("sets owner correctly", async function () {
            expect(await vault.owner()).to.equal(owner.address);
        });

        it("cannot be initialized twice", async function () {
            await expect(
                vault.connect(owner).initialize(owner.address, chain[CHAIN_DEPTH])
            ).to.be.revertedWith("Already initialized");
        });

        it("factory rejects second vault for same wallet", async function () {
            await expect(
                factory.connect(owner).createQryptSafe(chain[CHAIN_DEPTH])
            ).to.be.revertedWith("Qrypt-Safe already exists for this wallet");
        });

        it("factory rejects zero chain head", async function () {
            const [, other] = await ethers.getSigners();
            await expect(
                factory.connect(other).createQryptSafe(ethers.ZeroHash)
            ).to.be.revertedWith("Invalid chain head");
        });
    });

    // ── OTP Chain: shield ─────────────────────────────────────────────────

    describe("OTP Chain: shield()", function () {
        it("accepts H99 as first proof and mints qTokens", async function () {
            await vault.connect(owner).Qrypt(
                await token.getAddress(), SHIELD_AMOUNT, chain[99], GAS_OPTS
            );
            const qTokenAddr = await vault.getQTokenAddress(await token.getAddress());
            const qToken = await ethers.getContractAt("ShieldToken", qTokenAddr);
            expect(await qToken.balanceOf(owner.address)).to.equal(SHIELD_AMOUNT);
        });

        it("accepts H98 as second proof after H99 consumed", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99]);
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[98]);
            const balance = await vault.getQryptedBalance(await token.getAddress());
            expect(balance).to.equal(SHIELD_AMOUNT * 2n);
        });

        it("accepts sequential proofs H99 down to H95", async function () {
            for (let i = 99; i >= 95; i--) {
                await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[i]);
            }
            const balance = await vault.getQryptedBalance(await token.getAddress());
            expect(balance).to.equal(SHIELD_AMOUNT * 5n);
        });

        it("rejects replay: H99 cannot be used twice", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99]);
            await expect(
                vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99])
            ).to.be.revertedWith("Invalid vault proof");
        });

        it("rejects out-of-order proof: H98 before H99", async function () {
            await expect(
                vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[98])
            ).to.be.revertedWith("Invalid vault proof");
        });

        it("rejects wrong proof (random bytes)", async function () {
            const wrong = ethers.keccak256(ethers.toUtf8Bytes("wrongproof"));
            await expect(
                vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, wrong)
            ).to.be.revertedWith("Invalid vault proof");
        });

        it("rejects attacker calling shield", async function () {
            await expect(
                vault.connect(attacker).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99])
            ).to.be.revertedWith("Not vault owner");
        });

        it("rejects amount below minimum", async function () {
            await expect(
                vault.connect(owner).Qrypt(await token.getAddress(), 100n, chain[99])
            ).to.be.revertedWith("Amount below minimum");
        });

        it("emits QTokenCreated on first shield of a new token", async function () {
            await expect(
                vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99])
            ).to.emit(vault, "QTokenCreated");
        });

        it("does not emit QTokenCreated on second shield of same token", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99]);
            await expect(
                vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[98])
            ).to.not.emit(vault, "QTokenCreated");
        });
    });

    // ── OTP Chain: unshield ───────────────────────────────────────────────

    describe("OTP Chain: unshield()", function () {
        beforeEach(async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99]);
        });

        it("unshields with correct proof H98", async function () {
            const balBefore = await token.balanceOf(owner.address);
            await vault.connect(owner).unqrypt(await token.getAddress(), SHIELD_AMOUNT, chain[98]);
            const balAfter = await token.balanceOf(owner.address);
            expect(balAfter - balBefore).to.equal(SHIELD_AMOUNT);
        });

        it("rejects replay of H98", async function () {
            await vault.connect(owner).unqrypt(await token.getAddress(), SHIELD_AMOUNT / 2n, chain[98]);
            await expect(
                vault.connect(owner).unqrypt(await token.getAddress(), SHIELD_AMOUNT / 2n, chain[98])
            ).to.be.revertedWith("Invalid vault proof");
        });

        it("rejects proof from wrong position", async function () {
            await expect(
                vault.connect(owner).unqrypt(await token.getAddress(), SHIELD_AMOUNT, chain[97])
            ).to.be.revertedWith("Invalid vault proof");
        });

        it("rejects insufficient shielded balance", async function () {
            await expect(
                vault.connect(owner).unqrypt(await token.getAddress(), SHIELD_AMOUNT * 2n, chain[98])
            ).to.be.revertedWith("Insufficient qrypted balance");
        });

        it("rejects attacker calling unshield", async function () {
            await expect(
                vault.connect(attacker).unqrypt(await token.getAddress(), SHIELD_AMOUNT, chain[98])
            ).to.be.revertedWith("Not vault owner");
        });
    });

    // ── OTP Chain: revealTransfer ─────────────────────────────────────────

    describe("OTP Chain: revealTransfer()", function () {
        beforeEach(async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99]);
        });

        it("completes commit-reveal transfer with OTP proofs", async function () {
            const proof = chain[98];
            const nonce = BigInt(Math.floor(Math.random() * 1e15));
            const tokenAddr = await token.getAddress();
            const recipientAddr = recipient.address;

            const veilHash = ethers.keccak256(
                ethers.solidityPacked(
                    ["bytes32", "uint256", "address", "address", "uint256"],
                    [proof, nonce, tokenAddr, recipientAddr, SHIELD_AMOUNT]
                )
            );

            await vault.connect(owner).veilTransfer(veilHash);
            await ethers.provider.send("evm_mine", []);

            const balBefore = await token.balanceOf(recipientAddr);
            await vault.connect(owner).unveilTransfer(tokenAddr, recipientAddr, SHIELD_AMOUNT, proof, nonce);
            const balAfter = await token.balanceOf(recipientAddr);
            expect(balAfter - balBefore).to.equal(SHIELD_AMOUNT);
        });

        it("rejects reveal with wrong proof", async function () {
            const proof = chain[98];
            const wrongProof = chain[97];
            const nonce = BigInt(Math.floor(Math.random() * 1e15));
            const tokenAddr = await token.getAddress();

            const veilHash = ethers.keccak256(
                ethers.solidityPacked(
                    ["bytes32", "uint256", "address", "address", "uint256"],
                    [proof, nonce, tokenAddr, recipient.address, SHIELD_AMOUNT]
                )
            );

            await vault.connect(owner).veilTransfer(veilHash);
            await ethers.provider.send("evm_mine", []);

            await expect(
                vault.connect(owner).unveilTransfer(tokenAddr, recipient.address, SHIELD_AMOUNT, wrongProof, nonce)
            ).to.be.revertedWith("Invalid vault proof");
        });
    });

    // ── OTP Chain: rechargeChain ──────────────────────────────────────────

    describe("rechargeChain()", function () {
        it("recharges with H0 as currentProof and new chain head", async function () {
            // Exhaust chain to H0 position: need 99 proofs consumed (H99..H1)
            // For speed, we just manually drive chain to H1 then recharge with H0
            // Use a mini chain of depth 3 for this test
            const miniChain = buildChain("xyz789", 3);
            const [, , , freshSigner] = await ethers.getSigners();
            await factory.connect(freshSigner).createQryptSafe(miniChain[3]);
            const freshVaultAddr = await factory.getQryptSafe(freshSigner.address);
            const freshVault = await ethers.getContractAt("PersonalQryptSafeV6", freshVaultAddr);

            const mockToken = await deployMockERC20(freshSigner);
            await mockToken.connect(freshSigner).mint(freshSigner.address, SHIELD_AMOUNT * 10n);
            await mockToken.connect(freshSigner).approve(freshVaultAddr, ethers.MaxUint256);

            // Use H2, H1 (leaving H0 as recharge key)
            await freshVault.connect(freshSigner).Qrypt(await mockToken.getAddress(), SHIELD_AMOUNT, miniChain[2]);
            await freshVault.connect(freshSigner).Qrypt(await mockToken.getAddress(), SHIELD_AMOUNT, miniChain[1]);

            // Now head is H1. Recharge using H0 + new chain head
            const newChain = buildChain("xyz789_chain2", 3);
            await freshVault.connect(freshSigner).rechargeChain(newChain[3], miniChain[0]);

            // Can now use newChain[2] as first proof of new chain
            await freshVault.connect(freshSigner).Qrypt(await mockToken.getAddress(), SHIELD_AMOUNT, newChain[2]);
            const balance = await freshVault.getQryptedBalance(await mockToken.getAddress());
            expect(balance).to.equal(SHIELD_AMOUNT * 3n);
        });

        it("rejects recharge with wrong currentProof", async function () {
            const newChain = buildChain("newchain", 100);
            const wrongProof = ethers.keccak256(ethers.toUtf8Bytes("wrong"));
            await expect(
                vault.connect(owner).rechargeChain(newChain[100], wrongProof)
            ).to.be.revertedWith("Invalid recharge proof");
        });

        it("rejects recharge with zero newHead", async function () {
            await expect(
                vault.connect(owner).rechargeChain(ethers.ZeroHash, chain[99])
            ).to.be.revertedWith("Invalid new chain head");
        });

        it("rejects attacker calling rechargeChain", async function () {
            const newChain = buildChain("newchain", 100);
            await expect(
                vault.connect(attacker).rechargeChain(newChain[100], chain[99])
            ).to.be.revertedWith("Not vault owner");
        });

        it("emits ChainRecharged event", async function () {
            const newChain = buildChain("newchain", 3);
            const miniChain = buildChain("mini123", 2);
            const [, , , , freshSigner] = await ethers.getSigners();
            await factory.connect(freshSigner).createQryptSafe(miniChain[2]);
            const freshVaultAddr = await factory.getQryptSafe(freshSigner.address);
            const freshVault = await ethers.getContractAt("PersonalQryptSafeV6", freshVaultAddr);
            const mockToken = await deployMockERC20(freshSigner);
            await mockToken.connect(freshSigner).mint(freshSigner.address, SHIELD_AMOUNT * 5n);
            await mockToken.connect(freshSigner).approve(freshVaultAddr, ethers.MaxUint256);
            await freshVault.connect(freshSigner).Qrypt(await mockToken.getAddress(), SHIELD_AMOUNT, miniChain[1]);

            await expect(
                freshVault.connect(freshSigner).rechargeChain(newChain[3], miniChain[0])
            ).to.emit(freshVault, "ChainRecharged");
        });
    });

    // ── QryptAir: airBudget isolation ─────────────────────────────────────

    describe("fundAirBags() / reclaimAirBags()", function () {
        beforeEach(async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT * 2n, chain[99]);
        });

        it("funds air budget and reduces shielded balance", async function () {
            await vault.connect(owner).fundAirBags(await token.getAddress(), SHIELD_AMOUNT, chain[98]);
            expect(await vault.getAirBags(await token.getAddress())).to.equal(SHIELD_AMOUNT);
            expect(await vault.getQryptedBalance(await token.getAddress())).to.equal(SHIELD_AMOUNT);
        });

        it("reclaims air budget back to shielded balance", async function () {
            await vault.connect(owner).fundAirBags(await token.getAddress(), SHIELD_AMOUNT, chain[98]);
            await vault.connect(owner).reclaimAirBags(await token.getAddress(), chain[97]);
            expect(await vault.getAirBags(await token.getAddress())).to.equal(0n);
            expect(await vault.getQryptedBalance(await token.getAddress())).to.equal(SHIELD_AMOUNT * 2n);
        });

        it("rejects fundAirBudget with wrong proof", async function () {
            await expect(
                vault.connect(owner).fundAirBags(await token.getAddress(), SHIELD_AMOUNT, chain[97])
            ).to.be.revertedWith("Invalid vault proof");
        });

        it("rejects fundAirBudget exceeding shielded balance", async function () {
            await expect(
                vault.connect(owner).fundAirBags(await token.getAddress(), SHIELD_AMOUNT * 5n, chain[98])
            ).to.be.revertedWith("Insufficient qrypted balance");
        });

        it("rejects reclaimAirBudget when budget is zero", async function () {
            await expect(
                vault.connect(owner).reclaimAirBags(await token.getAddress(), chain[98])
            ).to.be.revertedWith("No air bags to reclaim");
        });

        it("rejects attacker calling fundAirBudget", async function () {
            await expect(
                vault.connect(attacker).fundAirBags(await token.getAddress(), SHIELD_AMOUNT, chain[98])
            ).to.be.revertedWith("Not vault owner");
        });

        it("emits AirBudgetFunded event", async function () {
            await expect(
                vault.connect(owner).fundAirBags(await token.getAddress(), SHIELD_AMOUNT, chain[98])
            ).to.emit(vault, "AirBagsFunded").withArgs(await token.getAddress(), SHIELD_AMOUNT);
        });

        it("emits AirBudgetReclaimed event", async function () {
            await vault.connect(owner).fundAirBags(await token.getAddress(), SHIELD_AMOUNT, chain[98]);
            await expect(
                vault.connect(owner).reclaimAirBags(await token.getAddress(), chain[97])
            ).to.emit(vault, "AirBagsReclaimed").withArgs(await token.getAddress(), SHIELD_AMOUNT);
        });
    });

    // ── QryptAir: redeemAirVoucher from airBudget ─────────────────────────

    describe("claimAirVoucher() from airBags only", function () {
        let deadline;
        let nonce;
        let transferCodeHash;

        const VOUCHER_TYPEHASH = ethers.keccak256(
            ethers.toUtf8Bytes(
                "Voucher(address token,uint256 amount,address recipient,uint256 deadline,bytes32 nonce,bytes32 transferCodeHash)"
            )
        );

        async function signVoucher(signer, tokenAddr, amount, recipientAddr, deadlineVal, nonceVal, codeHash) {
            const domain = {
                name: "QryptAir",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
            };
            const types = {
                Voucher: [
                    { name: "token",            type: "address" },
                    { name: "amount",           type: "uint256" },
                    { name: "recipient",        type: "address" },
                    { name: "deadline",         type: "uint256" },
                    { name: "nonce",            type: "bytes32" },
                    { name: "transferCodeHash", type: "bytes32" },
                ],
            };
            const value = { token: tokenAddr, amount, recipient: recipientAddr, deadline: deadlineVal, nonce: nonceVal, transferCodeHash: codeHash };
            return signer.signTypedData(domain, types, value);
        }

        beforeEach(async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT * 2n, chain[99]);
            await vault.connect(owner).fundAirBags(await token.getAddress(), SHIELD_AMOUNT, chain[98]);

            const latestBlock = await ethers.provider.getBlock("latest");
            deadline = BigInt(latestBlock.timestamp + 3600);
            nonce = ethers.keccak256(ethers.toUtf8Bytes("test-nonce-1"));
            transferCodeHash = ethers.keccak256(ethers.toUtf8Bytes("secret-code"));
        });

        it("redeems voucher from airBudget, not shielded balance", async function () {
            const tokenAddr = await token.getAddress();
            const sig = await signVoucher(owner, tokenAddr, SHIELD_AMOUNT, recipient.address, deadline, nonce, transferCodeHash);

            const shieldedBefore = await vault.getQryptedBalance(tokenAddr);
            const balBefore = await token.balanceOf(recipient.address);

            await vault.connect(recipient).claimAirVoucher(
                tokenAddr, SHIELD_AMOUNT, recipient.address, deadline, nonce, transferCodeHash, sig
            );

            const shieldedAfter = await vault.getQryptedBalance(tokenAddr);
            const balAfter = await token.balanceOf(recipient.address);

            expect(balAfter - balBefore).to.equal(SHIELD_AMOUNT);
            expect(shieldedAfter).to.equal(shieldedBefore);
            expect(await vault.getAirBags(tokenAddr)).to.equal(0n);
        });

        it("rejects redeem exceeding airBudget", async function () {
            const tokenAddr = await token.getAddress();
            const bigAmount = SHIELD_AMOUNT * 5n;
            const sig = await signVoucher(owner, tokenAddr, bigAmount, recipient.address, deadline, nonce, transferCodeHash);

            await expect(
                vault.connect(recipient).claimAirVoucher(
                    tokenAddr, bigAmount, recipient.address, deadline, nonce, transferCodeHash, sig
                )
            ).to.be.revertedWith("Insufficient air bags");
        });

        it("rejects expired voucher", async function () {
            const tokenAddr = await token.getAddress();
            const pastDeadline = BigInt(Math.floor(Date.now() / 1000) - 100);
            const sig = await signVoucher(owner, tokenAddr, SHIELD_AMOUNT, recipient.address, pastDeadline, nonce, transferCodeHash);

            await expect(
                vault.connect(recipient).claimAirVoucher(
                    tokenAddr, SHIELD_AMOUNT, recipient.address, pastDeadline, nonce, transferCodeHash, sig
                )
            ).to.be.revertedWith("Voucher expired");
        });

        it("rejects nonce replay", async function () {
            const tokenAddr = await token.getAddress();
            const sig = await signVoucher(owner, tokenAddr, SHIELD_AMOUNT / 2n, recipient.address, deadline, nonce, transferCodeHash);

            await vault.connect(recipient).claimAirVoucher(
                tokenAddr, SHIELD_AMOUNT / 2n, recipient.address, deadline, nonce, transferCodeHash, sig
            );

            const nonce2 = ethers.keccak256(ethers.toUtf8Bytes("test-nonce-2"));
            const sig2 = await signVoucher(owner, tokenAddr, SHIELD_AMOUNT / 2n, recipient.address, deadline, nonce2, transferCodeHash);
            await vault.connect(recipient).claimAirVoucher(
                tokenAddr, SHIELD_AMOUNT / 2n, recipient.address, deadline, nonce2, transferCodeHash, sig2
            );

            await expect(
                vault.connect(recipient).claimAirVoucher(
                    tokenAddr, SHIELD_AMOUNT / 2n, recipient.address, deadline, nonce, transferCodeHash, sig
                )
            ).to.be.revertedWith("Voucher already redeemed");
        });

        it("rejects signature from non-owner", async function () {
            const tokenAddr = await token.getAddress();
            const sig = await signVoucher(attacker, tokenAddr, SHIELD_AMOUNT, recipient.address, deadline, nonce, transferCodeHash);

            await expect(
                vault.connect(recipient).claimAirVoucher(
                    tokenAddr, SHIELD_AMOUNT, recipient.address, deadline, nonce, transferCodeHash, sig
                )
            ).to.be.revertedWith("Sig not from vault owner");
        });
    });

    // ── Emergency Withdraw ────────────────────────────────────────────────

    describe("emergencyWithdraw()", function () {
        it("is blocked before delay", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99]);
            await expect(
                vault.connect(owner).emergencyWithdraw([await token.getAddress()])
            ).to.be.revertedWith("Emergency withdraw not yet available");
        });

        it("succeeds after EMERGENCY_DELAY_BLOCKS", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99]);

            const delay = await vault.EMERGENCY_DELAY_BLOCKS();
            await time.advanceBlock(Number(delay));

            const balBefore = await token.balanceOf(owner.address);
            await vault.connect(owner).emergencyWithdraw([await token.getAddress()]);
            const balAfter = await token.balanceOf(owner.address);
            expect(balAfter - balBefore).to.equal(SHIELD_AMOUNT);
        });
    });

    // ── View Functions ────────────────────────────────────────────────────

    describe("View functions", function () {
        it("getShieldedBalance returns 0 for unshielded token", async function () {
            expect(await vault.getQryptedBalance(await token.getAddress())).to.equal(0n);
        });

        it("getAirBudget returns 0 before funding", async function () {
            expect(await vault.getAirBags(await token.getAddress())).to.equal(0n);
        });

        it("getEmergencyWithdrawAvailableBlock returns correct block", async function () {
            const last = await vault.lastActivityBlock();
            const delay = await vault.EMERGENCY_DELAY_BLOCKS();
            expect(await vault.getEmergencyWithdrawAvailableBlock()).to.equal(last + delay);
        });

        it("factory hasVault returns true after createVault", async function () {
            expect(await factory.hasQryptSafe(owner.address)).to.equal(true);
        });

        it("factory hasVault returns false for unknown wallet", async function () {
            expect(await factory.hasQryptSafe(attacker.address)).to.equal(false);
        });
    });

    // ── Multi-token isolation ─────────────────────────────────────────────

    describe("Multi-token isolation", function () {
        let tokenB;

        beforeEach(async function () {
            tokenB = await deployMockERC20(owner);
            await tokenB.connect(owner).mint(owner.address, ethers.parseUnits("100000", 6));
            await tokenB.connect(owner).approve(await vault.getAddress(), ethers.MaxUint256);
        });

        it("qrypting tokenA does not affect tokenB qryptedBalance", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99]);
            expect(await vault.getQryptedBalance(await tokenB.getAddress())).to.equal(0n);
        });

        it("unqrypting tokenA does not affect tokenB qryptedBalance", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99]);
            await vault.connect(owner).Qrypt(await tokenB.getAddress(), SHIELD_AMOUNT, chain[98]);
            await vault.connect(owner).unqrypt(await token.getAddress(), SHIELD_AMOUNT, chain[97]);
            expect(await vault.getQryptedBalance(await tokenB.getAddress())).to.equal(SHIELD_AMOUNT);
        });

        it("returns 0 qryptedBalance for a token never qrypted", async function () {
            expect(await vault.getQryptedBalance(await tokenB.getAddress())).to.equal(0n);
        });

        it("multiple tokens accumulate independently in the same vault", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99]);
            await vault.connect(owner).Qrypt(await tokenB.getAddress(), SHIELD_AMOUNT * 2n, chain[98]);
            expect(await vault.getQryptedBalance(await token.getAddress())).to.equal(SHIELD_AMOUNT);
            expect(await vault.getQryptedBalance(await tokenB.getAddress())).to.equal(SHIELD_AMOUNT * 2n);
        });

        it("qToken addresses are distinct for different underlying tokens", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99]);
            await vault.connect(owner).Qrypt(await tokenB.getAddress(), SHIELD_AMOUNT, chain[98]);
            const qTokenA = await vault.getQTokenAddress(await token.getAddress());
            const qTokenB = await vault.getQTokenAddress(await tokenB.getAddress());
            expect(qTokenA).to.not.equal(qTokenB);
        });

        it("fundAirBags for tokenA does not affect tokenB airBags", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT * 2n, chain[99]);
            await vault.connect(owner).Qrypt(await tokenB.getAddress(), SHIELD_AMOUNT, chain[98]);
            await vault.connect(owner).fundAirBags(await token.getAddress(), SHIELD_AMOUNT, chain[97]);
            expect(await vault.getAirBags(await tokenB.getAddress())).to.equal(0n);
        });

        it("reclaimAirBags for tokenA restores only tokenA qryptedBalance", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT * 2n, chain[99]);
            await vault.connect(owner).Qrypt(await tokenB.getAddress(), SHIELD_AMOUNT, chain[98]);
            await vault.connect(owner).fundAirBags(await token.getAddress(), SHIELD_AMOUNT, chain[97]);
            await vault.connect(owner).reclaimAirBags(await token.getAddress(), chain[96]);
            expect(await vault.getQryptedBalance(await token.getAddress())).to.equal(SHIELD_AMOUNT * 2n);
            expect(await vault.getQryptedBalance(await tokenB.getAddress())).to.equal(SHIELD_AMOUNT);
        });

        it("emergencyWithdraw for tokenA only drains tokenA qryptedBalance", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99]);
            await vault.connect(owner).Qrypt(await tokenB.getAddress(), SHIELD_AMOUNT, chain[98]);
            const delay = await vault.EMERGENCY_DELAY_BLOCKS();
            await time.advanceBlock(Number(delay));
            await vault.connect(owner).emergencyWithdraw([await token.getAddress()]);
            expect(await vault.getQryptedBalance(await tokenB.getAddress())).to.equal(SHIELD_AMOUNT);
        });

        it("two separate vaults hold independent balances for the same token", async function () {
            const chain2 = buildChain("vault2proof", 100);
            const [, , , signer2] = await ethers.getSigners();
            await factory.connect(signer2).createQryptSafe(chain2[100]);
            const vault2Addr = await factory.getQryptSafe(signer2.address);
            const vault2 = await ethers.getContractAt("PersonalQryptSafeV6", vault2Addr);
            await token.connect(owner).transfer(signer2.address, SHIELD_AMOUNT * 2n);
            await token.connect(signer2).approve(vault2Addr, ethers.MaxUint256);

            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99]);
            await vault2.connect(signer2).Qrypt(await token.getAddress(), SHIELD_AMOUNT * 2n, chain2[99]);

            expect(await vault.getQryptedBalance(await token.getAddress())).to.equal(SHIELD_AMOUNT);
            expect(await vault2.getQryptedBalance(await token.getAddress())).to.equal(SHIELD_AMOUNT * 2n);
        });
    });

    // ── State accounting: getQryptedBalance / getAirBags ─────────────────

    describe("State accounting: getQryptedBalance / getAirBags", function () {

        async function signVoucher2(signer, tokenAddr, amount, recipientAddr, deadlineVal, nonceVal, codeHash) {
            const domain = {
                name: "QryptAir",
                version: "1",
                chainId: (await ethers.provider.getNetwork()).chainId,
            };
            const types = {
                Voucher: [
                    { name: "token",            type: "address" },
                    { name: "amount",           type: "uint256" },
                    { name: "recipient",        type: "address" },
                    { name: "deadline",         type: "uint256" },
                    { name: "nonce",            type: "bytes32" },
                    { name: "transferCodeHash", type: "bytes32" },
                ],
            };
            const value = {
                token: tokenAddr, amount, recipient: recipientAddr,
                deadline: deadlineVal, nonce: nonceVal, transferCodeHash: codeHash,
            };
            return signer.signTypedData(domain, types, value);
        }

        it("getQryptedBalance increases by exact amount after qrypt", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99]);
            expect(await vault.getQryptedBalance(await token.getAddress())).to.equal(SHIELD_AMOUNT);
        });

        it("getQryptedBalance decreases by exact amount after unqrypt", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT * 3n, chain[99]);
            await vault.connect(owner).unqrypt(await token.getAddress(), SHIELD_AMOUNT, chain[98]);
            expect(await vault.getQryptedBalance(await token.getAddress())).to.equal(SHIELD_AMOUNT * 2n);
        });

        it("getQryptedBalance decreases by fund amount after fundAirBags", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT * 2n, chain[99]);
            await vault.connect(owner).fundAirBags(await token.getAddress(), SHIELD_AMOUNT, chain[98]);
            expect(await vault.getQryptedBalance(await token.getAddress())).to.equal(SHIELD_AMOUNT);
        });

        it("getQryptedBalance restores by reclaim amount after reclaimAirBags", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT * 2n, chain[99]);
            await vault.connect(owner).fundAirBags(await token.getAddress(), SHIELD_AMOUNT, chain[98]);
            await vault.connect(owner).reclaimAirBags(await token.getAddress(), chain[97]);
            expect(await vault.getQryptedBalance(await token.getAddress())).to.equal(SHIELD_AMOUNT * 2n);
        });

        it("getAirBags increases by exact amount after fundAirBags", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT * 2n, chain[99]);
            await vault.connect(owner).fundAirBags(await token.getAddress(), SHIELD_AMOUNT, chain[98]);
            expect(await vault.getAirBags(await token.getAddress())).to.equal(SHIELD_AMOUNT);
        });

        it("getAirBags decreases by claimed amount after claimAirVoucher", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT * 2n, chain[99]);
            await vault.connect(owner).fundAirBags(await token.getAddress(), SHIELD_AMOUNT, chain[98]);
            const tokenAddr = await token.getAddress();
            const block = await ethers.provider.getBlock("latest");
            const deadline = BigInt(block.timestamp + 3600);
            const nonce = ethers.keccak256(ethers.toUtf8Bytes("acc-nonce-1"));
            const codeHash = ethers.keccak256(ethers.toUtf8Bytes("acc-code-1"));
            const claimAmt = SHIELD_AMOUNT / 2n;
            const sig = await signVoucher2(owner, tokenAddr, claimAmt, recipient.address, deadline, nonce, codeHash);
            await vault.connect(recipient).claimAirVoucher(tokenAddr, claimAmt, recipient.address, deadline, nonce, codeHash, sig);
            expect(await vault.getAirBags(tokenAddr)).to.equal(SHIELD_AMOUNT - claimAmt);
        });

        it("getQryptedBalance is unchanged after claimAirVoucher", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT * 2n, chain[99]);
            await vault.connect(owner).fundAirBags(await token.getAddress(), SHIELD_AMOUNT, chain[98]);
            const tokenAddr = await token.getAddress();
            const qryptedBefore = await vault.getQryptedBalance(tokenAddr);
            const block = await ethers.provider.getBlock("latest");
            const deadline = BigInt(block.timestamp + 3600);
            const nonce = ethers.keccak256(ethers.toUtf8Bytes("acc-nonce-2"));
            const codeHash = ethers.keccak256(ethers.toUtf8Bytes("acc-code-2"));
            const sig = await signVoucher2(owner, tokenAddr, SHIELD_AMOUNT / 2n, recipient.address, deadline, nonce, codeHash);
            await vault.connect(recipient).claimAirVoucher(tokenAddr, SHIELD_AMOUNT / 2n, recipient.address, deadline, nonce, codeHash, sig);
            expect(await vault.getQryptedBalance(tokenAddr)).to.equal(qryptedBefore);
        });

        it("cumulative qrypt calls accumulate getQryptedBalance", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99]);
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT * 2n, chain[98]);
            expect(await vault.getQryptedBalance(await token.getAddress())).to.equal(SHIELD_AMOUNT * 3n);
        });

        it("getAirBags is 0 for a token never funded", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99]);
            expect(await vault.getAirBags(await token.getAddress())).to.equal(0n);
        });
    });

    // ── Security: attacker with private key + calldata history ───────────

    describe("Security: OTP replay attack resistance", function () {
        it("attacker who sees H99 in calldata cannot use it again", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99]);

            // Attacker grabs H99 from calldata (simulated), tries to call unshield
            await expect(
                vault.connect(attacker).unqrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99])
            ).to.be.revertedWith("Not vault owner");
        });

        it("attacker who owns the wallet but only has H99 cannot drain (proof consumed)", async function () {
            await vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT * 2n, chain[99]);

            // Attacker only has H99 (from calldata), tries to use it for unshield
            // Head is now H99, so keccak256(H99) = H100 != H99 -- will fail
            await expect(
                vault.connect(owner).unqrypt(await token.getAddress(), SHIELD_AMOUNT, chain[99])
            ).to.be.revertedWith("Invalid vault proof");
        });

        it("H100 (contract-stored head) is never a valid callable proof", async function () {
            // H100 is stored as the head. For it to be valid, keccak256(H100) must equal H100, impossible.
            await expect(
                vault.connect(owner).Qrypt(await token.getAddress(), SHIELD_AMOUNT, chain[100])
            ).to.be.revertedWith("Invalid vault proof");
        });
    });
});
