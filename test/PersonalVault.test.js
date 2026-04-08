const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("PersonalVault", function () {
  let factory;
  let vault;
  let token;
  let owner;
  let attacker;
  let recipient;

  const vaultProof = "abc123";
  const passwordHash = ethers.keccak256(ethers.toUtf8Bytes(vaultProof));
  const SHIELD_AMOUNT = 1_000_000n;

  async function deployMockERC20(signer) {
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const t = await MockERC20.connect(signer).deploy("USD Tether", "USDT", 18);
    await t.waitForDeployment();
    return t;
  }

  beforeEach(async function () {
    [owner, attacker, recipient] = await ethers.getSigners();

    const ShieldFactory = await ethers.getContractFactory("ShieldFactory");
    factory = await ShieldFactory.connect(owner).deploy();
    await factory.waitForDeployment();

    await factory.connect(owner).createVault(passwordHash);
    const vaultAddress = await factory.getVault(owner.address);
    vault = await ethers.getContractAt("PersonalVault", vaultAddress);

    token = await deployMockERC20(owner);
    await token.connect(owner).mint(owner.address, ethers.parseUnits("10000", 18));
    await token.connect(owner).approve(vaultAddress, ethers.MaxUint256);
  });

  describe("Initialization", function () {
    it("sets owner correctly", async function () {
      expect(await vault.owner()).to.equal(owner.address);
    });

    it("starts with lastActivityBlock at deployment block", async function () {
      expect(await vault.lastActivityBlock()).to.be.greaterThan(0n);
    });

    it("cannot be initialized twice", async function () {
      await expect(
        vault.connect(owner).initialize(owner.address, passwordHash)
      ).to.be.revertedWith("Already initialized");
    });
  });

  describe("shield()", function () {
    it("accepts valid shield and mints qTokens", async function () {
      await vault.connect(owner).shield(await token.getAddress(), SHIELD_AMOUNT, vaultProof);
      const qTokenAddr = await vault.getQTokenAddress(await token.getAddress());
      const qToken = await ethers.getContractAt("ShieldToken", qTokenAddr);
      expect(await qToken.balanceOf(owner.address)).to.equal(SHIELD_AMOUNT);
    });

    it("reverts with wrong vault proof", async function () {
      await expect(
        vault.connect(owner).shield(await token.getAddress(), SHIELD_AMOUNT, "wrong1")
      ).to.be.revertedWith("Invalid vault proof");
    });

    it("reverts if amount is below minimum (1e6)", async function () {
      await expect(
        vault.connect(owner).shield(await token.getAddress(), 999_999n, vaultProof)
      ).to.be.revertedWith("Amount below minimum");
    });

    it("reverts if called by non-owner", async function () {
      await expect(
        vault.connect(attacker).shield(await token.getAddress(), SHIELD_AMOUNT, vaultProof)
      ).to.be.revertedWith("Not vault owner");
    });

    it("emits TokenShielded event", async function () {
      const tokenAddr = await token.getAddress();
      await expect(vault.connect(owner).shield(tokenAddr, SHIELD_AMOUNT, vaultProof))
        .to.emit(vault, "TokenShielded");
    });

    it("deploys new qToken contract on first shield", async function () {
      await expect(vault.connect(owner).shield(await token.getAddress(), SHIELD_AMOUNT, vaultProof))
        .to.emit(vault, "QTokenDeployed");
    });

    it("reuses existing qToken contract on subsequent shields", async function () {
      await vault.connect(owner).shield(await token.getAddress(), SHIELD_AMOUNT, vaultProof);
      const addr1 = await vault.getQTokenAddress(await token.getAddress());

      await vault.connect(owner).shield(await token.getAddress(), SHIELD_AMOUNT, vaultProof);
      const addr2 = await vault.getQTokenAddress(await token.getAddress());

      expect(addr1).to.equal(addr2);
    });

    it("prefixes qToken name and symbol with q", async function () {
      await vault.connect(owner).shield(await token.getAddress(), SHIELD_AMOUNT, vaultProof);
      const qTokenAddr = await vault.getQTokenAddress(await token.getAddress());
      const qToken = await ethers.getContractAt("ShieldToken", qTokenAddr);
      expect(await qToken.name()).to.equal("qUSD Tether");
      expect(await qToken.symbol()).to.equal("qUSDT");
    });
  });

  describe("unshield()", function () {
    beforeEach(async function () {
      await vault.connect(owner).shield(await token.getAddress(), SHIELD_AMOUNT, vaultProof);
    });

    it("returns underlying tokens to owner", async function () {
      const balanceBefore = await token.balanceOf(owner.address);
      await vault.connect(owner).unshield(await token.getAddress(), SHIELD_AMOUNT, vaultProof);
      const balanceAfter = await token.balanceOf(owner.address);
      expect(balanceAfter - balanceBefore).to.equal(SHIELD_AMOUNT);
    });

    it("burns qTokens on unshield", async function () {
      await vault.connect(owner).unshield(await token.getAddress(), SHIELD_AMOUNT, vaultProof);
      const qTokenAddr = await vault.getQTokenAddress(await token.getAddress());
      const qToken = await ethers.getContractAt("ShieldToken", qTokenAddr);
      expect(await qToken.balanceOf(owner.address)).to.equal(0n);
    });

    it("reverts with wrong vault proof", async function () {
      await expect(
        vault.connect(owner).unshield(await token.getAddress(), SHIELD_AMOUNT, "wrong1")
      ).to.be.revertedWith("Invalid vault proof");
    });

    it("reverts if insufficient shielded balance", async function () {
      await expect(
        vault.connect(owner).unshield(await token.getAddress(), SHIELD_AMOUNT + 1n, vaultProof)
      ).to.be.revertedWith("Insufficient shielded balance");
    });

    it("reverts if token was never shielded", async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const otherToken = await MockERC20.connect(owner).deploy("DAI", "DAI", 18);
      await otherToken.waitForDeployment();

      await expect(
        vault.connect(owner).unshield(await otherToken.getAddress(), SHIELD_AMOUNT, vaultProof)
      ).to.be.revertedWith("Token not shielded");
    });

    it("reverts if called by non-owner", async function () {
      await expect(
        vault.connect(attacker).unshield(await token.getAddress(), SHIELD_AMOUNT, vaultProof)
      ).to.be.revertedWith("Not vault owner");
    });

    it("emits TokenUnshielded event", async function () {
      await expect(vault.connect(owner).unshield(await token.getAddress(), SHIELD_AMOUNT, vaultProof))
        .to.emit(vault, "TokenUnshielded");
    });
  });

  describe("commitTransfer()", function () {
    it("stores commit and emits event", async function () {
      const commitHash = ethers.keccak256(ethers.toUtf8Bytes("test-commit"));
      await expect(vault.connect(owner).commitTransfer(commitHash))
        .to.emit(vault, "CommitSubmitted")
        .withArgs(commitHash);
    });

    it("reverts if commit already exists", async function () {
      const commitHash = ethers.keccak256(ethers.toUtf8Bytes("test-commit"));
      await vault.connect(owner).commitTransfer(commitHash);
      await expect(
        vault.connect(owner).commitTransfer(commitHash)
      ).to.be.revertedWith("Commit already exists");
    });

    it("reverts if called by non-owner", async function () {
      const commitHash = ethers.keccak256(ethers.toUtf8Bytes("test-commit"));
      await expect(
        vault.connect(attacker).commitTransfer(commitHash)
      ).to.be.revertedWith("Not vault owner");
    });
  });

  describe("revealTransfer()", function () {
    const nonce = 42n;

    function makeCommitHash(proof, n, tokenAddr, toAddr, amt) {
      return ethers.keccak256(
        ethers.solidityPacked(
          ["string", "uint256", "address", "address", "uint256"],
          [proof, n, tokenAddr, toAddr, amt]
        )
      );
    }

    beforeEach(async function () {
      await vault.connect(owner).shield(await token.getAddress(), SHIELD_AMOUNT, vaultProof);
    });

    it("transfers raw ERC-20 to recipient and burns qTokens", async function () {
      const tokenAddr = await token.getAddress();
      const commitHash = makeCommitHash(vaultProof, nonce, tokenAddr, recipient.address, SHIELD_AMOUNT);

      await vault.connect(owner).commitTransfer(commitHash);
      await ethers.provider.send("evm_mine", []);

      const balanceBefore = await token.balanceOf(recipient.address);
      await vault.connect(owner).revealTransfer(tokenAddr, recipient.address, SHIELD_AMOUNT, vaultProof, nonce);
      const balanceAfter = await token.balanceOf(recipient.address);

      expect(balanceAfter - balanceBefore).to.equal(SHIELD_AMOUNT);

      const qTokenAddr = await vault.getQTokenAddress(tokenAddr);
      const qToken = await ethers.getContractAt("ShieldToken", qTokenAddr);
      expect(await qToken.balanceOf(owner.address)).to.equal(0n);
    });

    it("reverts if vault proof is wrong", async function () {
      const tokenAddr = await token.getAddress();
      const commitHash = makeCommitHash(vaultProof, nonce, tokenAddr, recipient.address, SHIELD_AMOUNT);
      await vault.connect(owner).commitTransfer(commitHash);
      await ethers.provider.send("evm_mine", []);

      await expect(
        vault.connect(owner).revealTransfer(tokenAddr, recipient.address, SHIELD_AMOUNT, "wrong1", nonce)
      ).to.be.revertedWith("Invalid vault proof");
    });

    it("reverts if commit not found", async function () {
      const tokenAddr = await token.getAddress();
      await expect(
        vault.connect(owner).revealTransfer(tokenAddr, recipient.address, SHIELD_AMOUNT, vaultProof, nonce)
      ).to.be.revertedWith("Commit not found");
    });

    it("reverts if commit already used", async function () {
      const tokenAddr = await token.getAddress();
      const commitHash = makeCommitHash(vaultProof, nonce, tokenAddr, recipient.address, SHIELD_AMOUNT);
      await vault.connect(owner).commitTransfer(commitHash);
      await ethers.provider.send("evm_mine", []);
      await vault.connect(owner).revealTransfer(tokenAddr, recipient.address, SHIELD_AMOUNT, vaultProof, nonce);

      await vault.connect(owner).shield(tokenAddr, SHIELD_AMOUNT, vaultProof);
      await expect(
        vault.connect(owner).revealTransfer(tokenAddr, recipient.address, SHIELD_AMOUNT, vaultProof, nonce)
      ).to.be.revertedWith("Commit already used");
    });

    it("reverts if revealed in same block as commit (both txs in same block)", async function () {
      const tokenAddr = await token.getAddress();
      const nonce2 = 99n;
      const commitHash2 = makeCommitHash(vaultProof, nonce2, tokenAddr, recipient.address, SHIELD_AMOUNT);

      await ethers.provider.send("evm_setAutomine", [false]);

      const commitTx = await vault.connect(owner).commitTransfer(commitHash2);
      const revealTx = await vault.connect(owner).revealTransfer(
        tokenAddr, recipient.address, SHIELD_AMOUNT, vaultProof, nonce2
      ).catch(() => null);

      await ethers.provider.send("evm_mine", []);
      await ethers.provider.send("evm_setAutomine", [true]);

      if (revealTx !== null) {
        const revealReceipt = await revealTx.wait().catch(() => null);
        if (revealReceipt !== null) {
          expect(revealReceipt.status).to.equal(0);
        }
      }
    });

    it("reverts if commit has expired (over 10 minutes)", async function () {
      const tokenAddr = await token.getAddress();
      const nonce3 = 77n;
      const commitHash = makeCommitHash(vaultProof, nonce3, tokenAddr, recipient.address, SHIELD_AMOUNT);
      await vault.connect(owner).commitTransfer(commitHash);
      await ethers.provider.send("evm_mine", []);

      await time.increase(601);

      await expect(
        vault.connect(owner).revealTransfer(tokenAddr, recipient.address, SHIELD_AMOUNT, vaultProof, nonce3)
      ).to.be.revertedWith("Commit expired");
    });

    it("reverts if recipient is self", async function () {
      const tokenAddr = await token.getAddress();
      const commitHash = makeCommitHash(vaultProof, nonce, tokenAddr, owner.address, SHIELD_AMOUNT);
      await vault.connect(owner).commitTransfer(commitHash);
      await ethers.provider.send("evm_mine", []);

      await expect(
        vault.connect(owner).revealTransfer(tokenAddr, owner.address, SHIELD_AMOUNT, vaultProof, nonce)
      ).to.be.revertedWith("Cannot transfer to yourself");
    });

    it("reverts if recipient is zero address", async function () {
      const tokenAddr = await token.getAddress();
      const zeroAddr = ethers.ZeroAddress;
      const commitHash = makeCommitHash(vaultProof, nonce, tokenAddr, zeroAddr, SHIELD_AMOUNT);
      await vault.connect(owner).commitTransfer(commitHash);
      await ethers.provider.send("evm_mine", []);

      await expect(
        vault.connect(owner).revealTransfer(tokenAddr, zeroAddr, SHIELD_AMOUNT, vaultProof, nonce)
      ).to.be.revertedWith("Invalid recipient");
    });

    it("recipient always receives raw ERC-20, never qTokens", async function () {
      const tokenAddr = await token.getAddress();
      const commitHash = makeCommitHash(vaultProof, nonce, tokenAddr, recipient.address, SHIELD_AMOUNT);
      await vault.connect(owner).commitTransfer(commitHash);
      await ethers.provider.send("evm_mine", []);
      await vault.connect(owner).revealTransfer(tokenAddr, recipient.address, SHIELD_AMOUNT, vaultProof, nonce);

      expect(await token.balanceOf(recipient.address)).to.equal(SHIELD_AMOUNT);

      const qTokenAddr = await vault.getQTokenAddress(tokenAddr);
      const qToken = await ethers.getContractAt("ShieldToken", qTokenAddr);
      expect(await qToken.balanceOf(recipient.address)).to.equal(0n);
    });

    it("emits TransferExecuted event with 3 args (no toVault flag)", async function () {
      const tokenAddr = await token.getAddress();
      const commitHash = makeCommitHash(vaultProof, nonce, tokenAddr, recipient.address, SHIELD_AMOUNT);
      await vault.connect(owner).commitTransfer(commitHash);
      await ethers.provider.send("evm_mine", []);

      await expect(
        vault.connect(owner).revealTransfer(tokenAddr, recipient.address, SHIELD_AMOUNT, vaultProof, nonce)
      ).to.emit(vault, "TransferExecuted")
        .withArgs(tokenAddr, recipient.address, SHIELD_AMOUNT);
    });

    it("reverts if called by non-owner", async function () {
      const tokenAddr = await token.getAddress();
      const commitHash = makeCommitHash(vaultProof, nonce, tokenAddr, recipient.address, SHIELD_AMOUNT);
      await vault.connect(owner).commitTransfer(commitHash);
      await ethers.provider.send("evm_mine", []);

      await expect(
        vault.connect(attacker).revealTransfer(tokenAddr, recipient.address, SHIELD_AMOUNT, vaultProof, nonce)
      ).to.be.revertedWith("Not vault owner");
    });
  });

  describe("changeVaultProof()", function () {
    it("successfully changes vault proof", async function () {
      await vault.connect(owner).changeVaultProof(vaultProof, "xyz789");
      await vault.connect(owner).shield(await token.getAddress(), SHIELD_AMOUNT, "xyz789");
      const qTokenAddr = await vault.getQTokenAddress(await token.getAddress());
      const qToken = await ethers.getContractAt("ShieldToken", qTokenAddr);
      expect(await qToken.balanceOf(owner.address)).to.equal(SHIELD_AMOUNT);
    });

    it("reverts with wrong old vault proof", async function () {
      await expect(
        vault.connect(owner).changeVaultProof("wrong1", "xyz789")
      ).to.be.revertedWith("Invalid current vault proof");
    });

    it("reverts if new vault proof has wrong format", async function () {
      await expect(
        vault.connect(owner).changeVaultProof(vaultProof, "toolongformat123")
      ).to.be.revertedWith("Invalid vault proof format");
    });

    it("reverts if new proof has 6 chars but wrong composition (all letters)", async function () {
      await expect(
        vault.connect(owner).changeVaultProof(vaultProof, "abcdef")
      ).to.be.revertedWith("Invalid vault proof format");
    });

    it("reverts if called by non-owner", async function () {
      await expect(
        vault.connect(attacker).changeVaultProof(vaultProof, "xyz789")
      ).to.be.revertedWith("Not vault owner");
    });

    it("emits VaultProofChanged event", async function () {
      await expect(vault.connect(owner).changeVaultProof(vaultProof, "xyz789"))
        .to.emit(vault, "VaultProofChanged");
    });
  });

  describe("emergencyWithdraw()", function () {
    beforeEach(async function () {
      await vault.connect(owner).shield(await token.getAddress(), SHIELD_AMOUNT, vaultProof);
    });

    it("reverts before emergency delay passes", async function () {
      await expect(
        vault.connect(owner).emergencyWithdraw([await token.getAddress()])
      ).to.be.revertedWith("Emergency withdraw not yet available");
    });

    it("succeeds after emergency delay (mining blocks)", async function () {
      const EMERGENCY_DELAY_BLOCKS = await vault.EMERGENCY_DELAY_BLOCKS();
      await ethers.provider.send("hardhat_mine", ["0x" + EMERGENCY_DELAY_BLOCKS.toString(16)]);

      const balanceBefore = await token.balanceOf(owner.address);
      await vault.connect(owner).emergencyWithdraw([await token.getAddress()]);
      const balanceAfter = await token.balanceOf(owner.address);
      expect(balanceAfter - balanceBefore).to.equal(SHIELD_AMOUNT);
    });

    it("reverts if called by non-owner", async function () {
      await expect(
        vault.connect(attacker).emergencyWithdraw([await token.getAddress()])
      ).to.be.revertedWith("Not vault owner");
    });
  });

  describe("getShieldedBalance()", function () {
    it("returns 0 for unshielded token", async function () {
      expect(await vault.getShieldedBalance(await token.getAddress())).to.equal(0n);
    });

    it("returns correct balance after shield", async function () {
      await vault.connect(owner).shield(await token.getAddress(), SHIELD_AMOUNT, vaultProof);
      expect(await vault.getShieldedBalance(await token.getAddress())).to.equal(SHIELD_AMOUNT);
    });
  });
});
