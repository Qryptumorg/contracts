const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ShieldFactory", function () {
  let factory;
  let owner;
  let user1;
  let user2;

  const vaultProof = "abc123";
  const passwordHash = ethers.keccak256(ethers.toUtf8Bytes(vaultProof));

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const ShieldFactory = await ethers.getContractFactory("ShieldFactory");
    factory = await ShieldFactory.connect(owner).deploy();
    await factory.waitForDeployment();
  });

  describe("Deployment", function () {
    it("sets deployer as owner", async function () {
      expect(await factory.owner()).to.equal(owner.address);
    });

    it("deploys a vault implementation", async function () {
      const impl = await factory.vaultImplementation();
      expect(impl).to.not.equal(ethers.ZeroAddress);
    });

    it("is not paused by default", async function () {
      expect(await factory.paused()).to.equal(false);
    });
  });

  describe("createVault", function () {
    it("creates a Qrypt-Safe for the caller", async function () {
      await factory.connect(user1).createVault(passwordHash);
      expect(await factory.hasVault(user1.address)).to.equal(true);
    });

    it("vault address is non-zero after creation", async function () {
      await factory.connect(user1).createVault(passwordHash);
      const vaultAddress = await factory.getVault(user1.address);
      expect(vaultAddress).to.not.equal(ethers.ZeroAddress);
    });

    it("emits VaultCreated event", async function () {
      const tx = await factory.connect(user1).createVault(passwordHash);
      await expect(tx).to.emit(factory, "VaultCreated").withArgs(
        user1.address,
        await factory.getVault(user1.address)
      );
    });

    it("reverts if user already has a Qrypt-Safe", async function () {
      await factory.connect(user1).createVault(passwordHash);
      await expect(
        factory.connect(user1).createVault(passwordHash)
      ).to.be.revertedWith("Qrypt-Safe already exists for this wallet");
    });

    it("creates separate vaults for different users", async function () {
      await factory.connect(user1).createVault(passwordHash);
      await factory.connect(user2).createVault(passwordHash);

      const vault1 = await factory.getVault(user1.address);
      const vault2 = await factory.getVault(user2.address);
      expect(vault1).to.not.equal(vault2);
    });

    it("reverts when paused", async function () {
      await factory.connect(owner).pause();
      await expect(
        factory.connect(user1).createVault(passwordHash)
      ).to.be.revertedWithCustomError(factory, "EnforcedPause");
    });
  });

  describe("hasVault / getVault", function () {
    it("returns false for wallet with no Qrypt-Safe", async function () {
      expect(await factory.hasVault(user1.address)).to.equal(false);
    });

    it("returns zero address for wallet with no Qrypt-Safe", async function () {
      expect(await factory.getVault(user1.address)).to.equal(ethers.ZeroAddress);
    });

    it("returns true after Qrypt-Safe creation", async function () {
      await factory.connect(user1).createVault(passwordHash);
      expect(await factory.hasVault(user1.address)).to.equal(true);
    });
  });

  describe("Pause / Unpause (owner only)", function () {
    it("owner can pause", async function () {
      await factory.connect(owner).pause();
      expect(await factory.paused()).to.equal(true);
    });

    it("owner can unpause", async function () {
      await factory.connect(owner).pause();
      await factory.connect(owner).unpause();
      expect(await factory.paused()).to.equal(false);
    });

    it("non-owner cannot pause", async function () {
      await expect(
        factory.connect(user1).pause()
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("non-owner cannot unpause", async function () {
      await factory.connect(owner).pause();
      await expect(
        factory.connect(user1).unpause()
      ).to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("vault creation works again after unpause", async function () {
      await factory.connect(owner).pause();
      await factory.connect(owner).unpause();
      await factory.connect(user1).createVault(passwordHash);
      expect(await factory.hasVault(user1.address)).to.equal(true);
    });
  });
});
