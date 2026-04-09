const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Integration: Full Shield/Transfer/Unshield Flow", function () {
  let factory;
  let vaultA;
  let vaultB;
  let usdt;
  let alice;
  let bob;
  let deployer;

  const aliceProof = "abc123";
  const bobProof = "xyz789";
  const aliceHash = ethers.keccak256(ethers.toUtf8Bytes(aliceProof));
  const bobHash = ethers.keccak256(ethers.toUtf8Bytes(bobProof));
  const SHIELD_AMOUNT = 5_000_000n;

  function makeCommitHash(proof, nonce, tokenAddr, toAddr, amt) {
    return ethers.keccak256(
      ethers.solidityPacked(
        ["string", "uint256", "address", "address", "uint256"],
        [proof, nonce, tokenAddr, toAddr, amt]
      )
    );
  }

  before(async function () {
    [deployer, alice, bob] = await ethers.getSigners();

    const ShieldFactory = await ethers.getContractFactory("ShieldFactory");
    factory = await ShieldFactory.connect(deployer).deploy();
    await factory.waitForDeployment();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdt = await MockERC20.connect(deployer).deploy("USD Tether", "USDT", 6);
    await usdt.waitForDeployment();

    await usdt.connect(deployer).mint(alice.address, ethers.parseUnits("1000", 6));
    await usdt.connect(deployer).mint(bob.address, ethers.parseUnits("500", 6));

    await factory.connect(alice).createVault(aliceHash);
    await factory.connect(bob).createVault(bobHash);

    const vaultAAddr = await factory.getVault(alice.address);
    const vaultBAddr = await factory.getVault(bob.address);
    vaultA = await ethers.getContractAt("PersonalVault", vaultAAddr);
    vaultB = await ethers.getContractAt("PersonalVault", vaultBAddr);

    await usdt.connect(alice).approve(vaultAAddr, ethers.MaxUint256);
    await usdt.connect(bob).approve(vaultBAddr, ethers.MaxUint256);
  });

  it("alice and bob have separate Qrypt-Safe addresses", async function () {
    expect(await factory.getVault(alice.address)).to.not.equal(await factory.getVault(bob.address));
  });

  it("alice shields USDT and receives qUSDT", async function () {
    const usdtAddr = await usdt.getAddress();
    await vaultA.connect(alice).shield(usdtAddr, SHIELD_AMOUNT, aliceProof);

    const qTokenAddr = await vaultA.getQTokenAddress(usdtAddr);
    const qToken = await ethers.getContractAt("ShieldToken", qTokenAddr);

    expect(await qToken.balanceOf(alice.address)).to.equal(SHIELD_AMOUNT);
    expect(await usdt.balanceOf(await vaultA.getAddress())).to.equal(SHIELD_AMOUNT);
  });

  it("qUSDT cannot be sent from alice wallet directly", async function () {
    const usdtAddr = await usdt.getAddress();
    const qTokenAddr = await vaultA.getQTokenAddress(usdtAddr);
    const qToken = await ethers.getContractAt("ShieldToken", qTokenAddr);

    await expect(
      qToken.connect(alice).transfer(bob.address, 1000n)
    ).to.be.revertedWith("qToken: transfers disabled, use Qryptum app");
  });

  it("alice commits and reveals a transfer to bob, bob receives raw USDT", async function () {
    const usdtAddr = await usdt.getAddress();
    const nonce = 1001n;
    const transferAmt = 2_000_000n;

    const commitHash = makeCommitHash(aliceProof, nonce, usdtAddr, bob.address, transferAmt);
    await vaultA.connect(alice).commitTransfer(commitHash);
    await ethers.provider.send("evm_mine", []);

    const bobUsdtBefore = await usdt.balanceOf(bob.address);
    await vaultA.connect(alice).revealTransfer(usdtAddr, bob.address, transferAmt, aliceProof, nonce);
    const bobUsdtAfter = await usdt.balanceOf(bob.address);

    expect(bobUsdtAfter - bobUsdtBefore).to.equal(transferAmt);
  });

  it("bob does NOT receive qUSDT from alice transfer, only raw USDT", async function () {
    const usdtAddr = await usdt.getAddress();
    const aliceQTokenAddr = await vaultA.getQTokenAddress(usdtAddr);
    const aliceQToken = await ethers.getContractAt("ShieldToken", aliceQTokenAddr);

    expect(await aliceQToken.balanceOf(bob.address)).to.equal(0n);
  });

  it("alice cannot transfer to herself", async function () {
    const usdtAddr = await usdt.getAddress();
    const nonce = 9999n;
    const commitHash = makeCommitHash(aliceProof, nonce, usdtAddr, alice.address, 1_000_000n);
    await vaultA.connect(alice).commitTransfer(commitHash);
    await ethers.provider.send("evm_mine", []);

    await expect(
      vaultA.connect(alice).revealTransfer(usdtAddr, alice.address, 1_000_000n, aliceProof, nonce)
    ).to.be.revertedWith("Cannot transfer to yourself");
  });

  it("bob can shield his received USDT into his own Qrypt-Safe", async function () {
    const usdtAddr = await usdt.getAddress();
    await vaultB.connect(bob).shield(usdtAddr, SHIELD_AMOUNT, bobProof);

    const qTokenAddr = await vaultB.getQTokenAddress(usdtAddr);
    const qToken = await ethers.getContractAt("ShieldToken", qTokenAddr);
    expect(await qToken.balanceOf(bob.address)).to.equal(SHIELD_AMOUNT);
  });

  it("alice can unshield remaining qUSDT back to raw USDT", async function () {
    const usdtAddr = await usdt.getAddress();
    const shieldedBalance = await vaultA.getShieldedBalance(usdtAddr);

    if (shieldedBalance > 0n) {
      const aliceUsdtBefore = await usdt.balanceOf(alice.address);
      await vaultA.connect(alice).unshield(usdtAddr, shieldedBalance, aliceProof);
      const aliceUsdtAfter = await usdt.balanceOf(alice.address);
      expect(aliceUsdtAfter - aliceUsdtBefore).to.equal(shieldedBalance);
    }
  });

  it("expired commit cannot be revealed", async function () {
    const usdtAddr = await usdt.getAddress();
    await usdt.connect(deployer).mint(alice.address, SHIELD_AMOUNT);
    await vaultA.connect(alice).shield(usdtAddr, SHIELD_AMOUNT, aliceProof);

    const nonce = 7777n;
    const commitHash = makeCommitHash(aliceProof, nonce, usdtAddr, bob.address, SHIELD_AMOUNT);
    await vaultA.connect(alice).commitTransfer(commitHash);
    await ethers.provider.send("evm_mine", []);

    await time.increase(601);

    await expect(
      vaultA.connect(alice).revealTransfer(usdtAddr, bob.address, SHIELD_AMOUNT, aliceProof, nonce)
    ).to.be.revertedWith("Commit expired");
  });

  it("attacker with leaked private key cannot move qTokens directly", async function () {
    const usdtAddr = await usdt.getAddress();
    await usdt.connect(deployer).mint(alice.address, SHIELD_AMOUNT);
    await vaultA.connect(alice).shield(usdtAddr, SHIELD_AMOUNT, aliceProof);

    const qTokenAddr = await vaultA.getQTokenAddress(usdtAddr);
    const qToken = await ethers.getContractAt("ShieldToken", qTokenAddr);

    await expect(
      qToken.connect(alice).transfer(bob.address, SHIELD_AMOUNT)
    ).to.be.revertedWith("qToken: transfers disabled, use Qryptum app");
  });

  it("factory can be paused and unpaused by deployer", async function () {
    await factory.connect(deployer).pause();
    expect(await factory.paused()).to.equal(true);

    const signers = await ethers.getSigners();
    const newUser = signers[3];
    await expect(
      factory.connect(newUser).createVault(aliceHash)
    ).to.be.revertedWithCustomError(factory, "EnforcedPause");

    await factory.connect(deployer).unpause();
    expect(await factory.paused()).to.equal(false);
  });
});
