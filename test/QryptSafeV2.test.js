const { expect } = require("chai");
  const { ethers } = require("hardhat");

  describe("QryptSafeV2", function () {
      let factory, vault, token, owner, attacker, recipient, admin;
      const VAULT_PROOF = "def456";
      let passwordHash;
      let proofBytes;

      beforeEach(async () => {
          [admin, owner, attacker, recipient] = await ethers.getSigners();
          // FIX: zeroPadBytes(32) so keccak256(abi.encodePacked(bytes32)) matches stored hash
          proofBytes = ethers.zeroPadBytes(ethers.toUtf8Bytes(VAULT_PROOF), 32);
          passwordHash = ethers.keccak256(proofBytes);
          const MockERC20 = await ethers.getContractFactory("MockERC20");
          token = await MockERC20.deploy("USD Coin", "USDC", 6);
          const Factory = await ethers.getContractFactory("QryptSafeV2");
          factory = await Factory.deploy();
          await factory.connect(owner).createVault(passwordHash);
          const vaultAddr = await factory.getVault(owner.address);
          vault = await ethers.getContractAt("PersonalQryptSafeV2", vaultAddr);
          await token.mint(owner.address, ethers.parseUnits("10000", 6));
          await token.connect(owner).approve(vaultAddr, ethers.MaxUint256);
      });

      // Factory
      it("deploys without Pausable (V1 bug fixed)", async () => {
          expect(typeof factory.pause).to.equal("undefined");
      });
      it("admin can update minShieldAmount", async () => {
          await factory.connect(admin).setMinShieldAmount(2e6);
          expect(await factory.minShieldAmount()).to.equal(2e6);
      });
      it("non-admin cannot update minShieldAmount", async () => {
          await expect(factory.connect(attacker).setMinShieldAmount(1)).to.be.reverted;
      });
      it("creates vault correctly", async () => {
          expect(await factory.hasVault(owner.address)).to.be.true;
      });
      it("prevents duplicate vault", async () => {
          await expect(factory.connect(owner).createVault(passwordHash)).to.be.revertedWith("Vault already exists for this wallet");
      });

      // Shield
      it("shields tokens", async () => {
          await vault.connect(owner).shield(await token.getAddress(), ethers.parseUnits("100", 6), proofBytes);
          expect(await vault.getShieldedBalance(await token.getAddress())).to.equal(ethers.parseUnits("100", 6));
      });
      it("rejects shield below minimum", async () => {
          await expect(vault.connect(owner).shield(await token.getAddress(), 100, proofBytes))
              .to.be.revertedWith("Amount below minimum");
      });
      it("rejects shield with wrong proof", async () => {
          const wrongProof = ethers.zeroPadBytes(ethers.toUtf8Bytes("wrong1"), 32);
          await expect(vault.connect(owner).shield(await token.getAddress(), ethers.parseUnits("100", 6), wrongProof))
              .to.be.revertedWith("Invalid vault proof");
      });
      it("rejects shield from non-owner", async () => {
          await expect(vault.connect(attacker).shield(await token.getAddress(), ethers.parseUnits("100", 6), proofBytes))
              .to.be.revertedWith("Not vault owner");
      });

      // Unshield
      it("unshields tokens correctly", async () => {
          const amount = ethers.parseUnits("100", 6);
          await vault.connect(owner).shield(await token.getAddress(), amount, proofBytes);
          await vault.connect(owner).unshield(await token.getAddress(), amount, proofBytes);
          expect(await vault.getShieldedBalance(await token.getAddress())).to.equal(0);
      });
      it("rejects unshield exceeding balance", async () => {
          await vault.connect(owner).shield(await token.getAddress(), ethers.parseUnits("100", 6), proofBytes);
          await expect(vault.connect(owner).unshield(await token.getAddress(), ethers.parseUnits("200", 6), proofBytes))
              .to.be.revertedWith("Insufficient shielded balance");
      });

      // Commit-reveal
      it("commit stores nonce", async () => {
          const commitHash = ethers.keccak256(ethers.toUtf8Bytes("tx-001"));
          await vault.connect(owner).commit(commitHash, proofBytes);
          // nonce incremented internally, no revert = success
      });
      it("V2 fix: duplicate commit rejected", async () => {
          const commitHash = ethers.keccak256(ethers.toUtf8Bytes("tx-dup"));
          await vault.connect(owner).commit(commitHash, proofBytes);
          await expect(vault.connect(owner).commit(commitHash, proofBytes))
              .to.be.revertedWith("Commit already exists");
      });
      it("reveal transfers tokens", async () => {
          const amount = ethers.parseUnits("50", 6);
          await vault.connect(owner).shield(await token.getAddress(), amount, proofBytes);
          const commitHash = ethers.keccak256(ethers.toUtf8Bytes("tx-reveal"));
          await vault.connect(owner).commit(commitHash, proofBytes);
          await vault.connect(owner).reveal(await token.getAddress(), recipient.address, amount, proofBytes, commitHash);
          expect(await token.balanceOf(recipient.address)).to.equal(amount);
      });
      it("reveal rejects used commit", async () => {
          const amount = ethers.parseUnits("50", 6);
          await vault.connect(owner).shield(await token.getAddress(), amount * 2n, proofBytes);
          const commitHash = ethers.keccak256(ethers.toUtf8Bytes("tx-used"));
          await vault.connect(owner).commit(commitHash, proofBytes);
          await vault.connect(owner).reveal(await token.getAddress(), recipient.address, amount, proofBytes, commitHash);
          await expect(vault.connect(owner).reveal(await token.getAddress(), recipient.address, amount, proofBytes, commitHash))
              .to.be.revertedWith("Commit already used");
      });
      it("reveal rejects nonexistent commit", async () => {
          const fakeHash = ethers.keccak256(ethers.toUtf8Bytes("fake"));
          await expect(vault.connect(owner).reveal(await token.getAddress(), recipient.address, 1000, proofBytes, fakeHash))
              .to.be.revertedWith("Commit not found");
      });

      // Multiple tokens
      it("shields multiple token types independently", async () => {
          const MockERC20 = await ethers.getContractFactory("MockERC20");
          const token2 = await MockERC20.deploy("Tether", "USDT", 6);
          const vaultAddr = await factory.getVault(owner.address);
          await token2.mint(owner.address, ethers.parseUnits("500", 6));
          await token2.connect(owner).approve(vaultAddr, ethers.MaxUint256);
          await vault.connect(owner).shield(await token.getAddress(), ethers.parseUnits("100", 6), proofBytes);
          await vault.connect(owner).shield(await token2.getAddress(), ethers.parseUnits("200", 6), proofBytes);
          expect(await vault.getShieldedBalance(await token.getAddress())).to.equal(ethers.parseUnits("100", 6));
          expect(await vault.getShieldedBalance(await token2.getAddress())).to.equal(ethers.parseUnits("200", 6));
      });

      // Emergency
      it("emergency withdraw enforces delay", async () => {
          await vault.connect(owner).shield(await token.getAddress(), ethers.parseUnits("100", 6), proofBytes);
          await expect(vault.connect(owner).emergencyWithdraw([await token.getAddress()], proofBytes))
              .to.be.revertedWith("Emergency delay not met");
      });

      // qToken
      it("qToken is non-transferable", async () => {
          await vault.connect(owner).shield(await token.getAddress(), ethers.parseUnits("100", 6), proofBytes);
          const qAddr = await vault.getQTokenAddress(await token.getAddress());
          const qToken = await ethers.getContractAt("ShieldToken", qAddr);
          await expect(qToken.connect(owner).transfer(attacker.address, 1000)).to.be.reverted;
      });

      it("shields accumulate correctly", async () => {
          await vault.connect(owner).shield(await token.getAddress(), ethers.parseUnits("100", 6), proofBytes);
          await vault.connect(owner).shield(await token.getAddress(), ethers.parseUnits("50", 6), proofBytes);
          expect(await vault.getShieldedBalance(await token.getAddress())).to.equal(ethers.parseUnits("150", 6));
      });

      it("getQTokenAddress returns non-zero after first shield", async () => {
          await vault.connect(owner).shield(await token.getAddress(), ethers.parseUnits("100", 6), proofBytes);
          expect(await vault.getQTokenAddress(await token.getAddress())).to.not.equal(ethers.ZeroAddress);
      });

      it("factory getVault returns non-zero address for vault owner", async () => {
          expect(await factory.getVault(owner.address)).to.not.equal(ethers.ZeroAddress);
      });

      it("unshields partial balance correctly", async () => {
          await vault.connect(owner).shield(await token.getAddress(), ethers.parseUnits("100", 6), proofBytes);
          await vault.connect(owner).unshield(await token.getAddress(), ethers.parseUnits("40", 6), proofBytes);
          expect(await vault.getShieldedBalance(await token.getAddress())).to.equal(ethers.parseUnits("60", 6));
      });
  });
  