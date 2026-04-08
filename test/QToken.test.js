const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ShieldToken (qToken)", function () {
  let qToken;
  let vault;
  let user;
  let other;

  beforeEach(async function () {
    [vault, user, other] = await ethers.getSigners();

    const ShieldToken = await ethers.getContractFactory("ShieldToken");
    qToken = await ShieldToken.connect(vault).deploy("qUSDT", "qUSDT", vault.address);
    await qToken.waitForDeployment();
  });

  describe("Deployment", function () {
    it("sets name and symbol correctly", async function () {
      expect(await qToken.name()).to.equal("qUSDT");
      expect(await qToken.symbol()).to.equal("qUSDT");
    });

    it("sets vault address correctly", async function () {
      expect(await qToken.vault()).to.equal(vault.address);
    });

    it("starts with zero total supply", async function () {
      expect(await qToken.totalSupply()).to.equal(0n);
    });
  });

  describe("Mint", function () {
    it("allows vault to mint tokens", async function () {
      await qToken.connect(vault).mint(user.address, 1000n);
      expect(await qToken.balanceOf(user.address)).to.equal(1000n);
    });

    it("reverts if non-vault tries to mint", async function () {
      await expect(
        qToken.connect(user).mint(user.address, 1000n)
      ).to.be.revertedWith("Only QRYPTANK can call this");
    });

    it("updates total supply on mint", async function () {
      await qToken.connect(vault).mint(user.address, 500n);
      expect(await qToken.totalSupply()).to.equal(500n);
    });
  });

  describe("Burn", function () {
    beforeEach(async function () {
      await qToken.connect(vault).mint(user.address, 1000n);
    });

    it("allows vault to burn tokens", async function () {
      await qToken.connect(vault).burn(user.address, 400n);
      expect(await qToken.balanceOf(user.address)).to.equal(600n);
    });

    it("reverts if non-vault tries to burn", async function () {
      await expect(
        qToken.connect(user).burn(user.address, 400n)
      ).to.be.revertedWith("Only QRYPTANK can call this");
    });

    it("reverts if burn exceeds balance", async function () {
      await expect(
        qToken.connect(vault).burn(user.address, 2000n)
      ).to.be.revertedWithCustomError(qToken, "ERC20InsufficientBalance");
    });
  });

  describe("Non-transferable enforcement", function () {
    beforeEach(async function () {
      await qToken.connect(vault).mint(user.address, 1000n);
    });

    it("reverts on transfer()", async function () {
      await expect(
        qToken.connect(user).transfer(other.address, 100n)
      ).to.be.revertedWith("qToken: transfers disabled, use Qryptum app");
    });

    it("reverts on transferFrom()", async function () {
      await expect(
        qToken.connect(user).transferFrom(user.address, other.address, 100n)
      ).to.be.revertedWith("qToken: transfers disabled, use Qryptum app");
    });

    it("reverts on approve()", async function () {
      await expect(
        qToken.connect(user).approve(other.address, 100n)
      ).to.be.revertedWith("qToken: approvals disabled");
    });
  });
});
