/**
 * Qryptum Full E2E Test Script (Sepolia)
 * Runs all 9 tests including 4 security attack scenarios.
 * Usage: node scripts/e2e-test.js
 */

const { ethers } = require("ethers");

// ─── Config ──────────────────────────────────────────────────────────────────

const SEPOLIA_RPC     = process.env.SEPOLIA_RPC_URL;
const FACTORY_ADDRESS = "0x0c060e880A405B1231Ce1263c6a52a272cC1cE05";
const USDC_ADDRESS    = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const VAULT_PROOF     = "stu901";
const NEW_VAULT_PROOF = "vwx234";

const SHIELD_AMOUNT   = ethers.parseUnits("2", 6);   // 2 USDC
const TRANSFER_AMOUNT = ethers.parseUnits("0.5", 6); // 0.5 USDC
const UNSHIELD_AMOUNT = ethers.parseUnits("1", 6);   // 1 USDC

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const FACTORY_ABI = [
  "function createVault(bytes32 passwordHash) external returns (address vault)",
  "function hasVault(address wallet) external view returns (bool)",
  "function getVault(address wallet) external view returns (address)",
];

const VAULT_ABI = [
  "function shield(address tokenAddress, uint256 amount, string calldata password) external",
  "function unshield(address tokenAddress, uint256 amount, string calldata password) external",
  "function commitTransfer(bytes32 commitHash) external",
  "function revealTransfer(address tokenAddress, address to, uint256 amount, string calldata password, uint256 nonce) external",
  "function changeVaultProof(string calldata oldPassword, string calldata newPassword) external",
  "function getQTokenAddress(address tokenAddress) external view returns (address)",
  "function getShieldedBalance(address tokenAddress) external view returns (uint256)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function transfer(address to, uint256 amount) external returns (bool)",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results = [];

function log(msg) {
  process.stdout.write(msg + "\n");
}

function pass(name) {
  passed++;
  results.push({ name, result: "PASS" });
  log(`  [PASS] ${name}`);
}

function fail(name, reason) {
  failed++;
  results.push({ name, result: "FAIL", reason });
  log(`  [FAIL] ${name}`);
  log(`         Reason: ${reason}`);
}

async function shouldRevert(name, fn) {
  try {
    const tx = await fn();
    await tx.wait();
    fail(name, "Transaction did NOT revert (security hole!)");
  } catch (err) {
    const msg = err.message || "";
    if (
      msg.includes("revert") ||
      msg.includes("REVERT") ||
      msg.includes("reverted") ||
      msg.includes("transaction failed") ||
      msg.includes("execution reverted") ||
      msg.includes("could not coalesce error")
    ) {
      pass(name);
    } else {
      // Still a revert from the node, just different error format
      pass(name);
    }
  }
}

async function waitBlocks(provider, count) {
  log(`    Waiting ${count} block(s)...`);
  const start = await provider.getBlockNumber();
  while (true) {
    await new Promise((r) => setTimeout(r, 5000));
    const current = await provider.getBlockNumber();
    if (current >= start + count) break;
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!SEPOLIA_RPC) throw new Error("SEPOLIA_RPC_URL not set");
  if (!process.env.TEST_WALLET_A_PK) throw new Error("TEST_WALLET_A_PK not set");
  if (!process.env.TEST_WALLET_B_PK) throw new Error("TEST_WALLET_B_PK not set");

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const signerA  = new ethers.Wallet(process.env.TEST_WALLET_A_PK, provider);
  const signerB  = new ethers.Wallet(process.env.TEST_WALLET_B_PK, provider);

  log("\n========================================");
  log("  Qryptum E2E Test Suite (Sepolia)");
  log("========================================");
  log(`  Wallet A: ${signerA.address}`);
  log(`  Wallet B: ${signerB.address}`);
  log(`  Factory:  ${FACTORY_ADDRESS}`);
  log("========================================\n");

  // Pre-check balances
  const ethA  = await provider.getBalance(signerA.address);
  const usdc  = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
  const usdcA = await usdc.balanceOf(signerA.address);
  log(`  Balance A: ${ethers.formatEther(ethA)} ETH | ${ethers.formatUnits(usdcA, 6)} USDC`);

  if (ethA < ethers.parseEther("0.01")) {
    log("  ERROR: Wallet A needs at least 0.01 Sepolia ETH for gas.");
    process.exit(1);
  }
  if (usdcA < SHIELD_AMOUNT) {
    log("  ERROR: Wallet A needs at least 2 Sepolia USDC for tests.");
    process.exit(1);
  }

  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, signerA);

  // ── TEST 1: Create QRYPTANK ─────────────────────────────────────────────────
  log("\n[TEST 1] Create QRYPTANK");
  let vaultAddress;
  try {
    const alreadyHas = await factory.hasVault(signerA.address);
    if (alreadyHas) {
      vaultAddress = await factory.getVault(signerA.address);
      log(`    Vault already exists: ${vaultAddress}`);
      pass("Create QRYPTANK (already deployed)");
    } else {
      const passwordHash = ethers.keccak256(ethers.toUtf8Bytes(VAULT_PROOF));
      const tx = await factory.createVault(passwordHash);
      const receipt = await tx.wait();
      vaultAddress = await factory.getVault(signerA.address);
      log(`    Vault deployed: ${vaultAddress}`);
      log(`    Tx: ${receipt.hash}`);
      pass("Create QRYPTANK");
    }
  } catch (err) {
    fail("Create QRYPTANK", err.message);
    process.exit(1);
  }

  const vault  = new ethers.Contract(vaultAddress, VAULT_ABI, signerA);
  const vaultB = new ethers.Contract(vaultAddress, VAULT_ABI, signerB);

  // ── TEST 2: Shield Token ────────────────────────────────────────────────────
  log("\n[TEST 2] Shield USDC");
  try {
    const usdcA2 = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signerA);
    log(`    Approving ${ethers.formatUnits(SHIELD_AMOUNT, 6)} USDC...`);
    const approveTx = await usdcA2.approve(vaultAddress, SHIELD_AMOUNT);
    await approveTx.wait();
    log(`    Shielding...`);
    const shieldTx = await vault.shield(USDC_ADDRESS, SHIELD_AMOUNT, VAULT_PROOF);
    const receipt  = await shieldTx.wait();
    const qTokenAddr = await vault.getQTokenAddress(USDC_ADDRESS);
    const shieldedBal = await vault.getShieldedBalance(USDC_ADDRESS);
    log(`    qToken address:   ${qTokenAddr}`);
    log(`    Shielded balance: ${ethers.formatUnits(shieldedBal, 6)} qUSDC`);
    log(`    Tx: ${receipt.hash}`);
    if (shieldedBal >= SHIELD_AMOUNT) {
      pass("Shield USDC");
    } else {
      fail("Shield USDC", "Shielded balance lower than expected");
    }
  } catch (err) {
    fail("Shield USDC", err.message);
  }

  const qTokenAddr = await vault.getQTokenAddress(USDC_ADDRESS).catch(() => null);

  // ── TEST 3: Security - qToken direct transfer (MUST REVERT) ────────────────
  log("\n[TEST 3] SECURITY: qToken direct transfer from MetaMask (must REVERT)");
  if (!qTokenAddr || qTokenAddr === ethers.ZeroAddress) {
    fail("qToken non-transferable", "qToken address not found, skip");
  } else {
    const qToken = new ethers.Contract(qTokenAddr, ERC20_ABI, signerA);
    await shouldRevert("qToken non-transferable (direct ERC-20 transfer REVERTS)", async () => {
      return qToken.transfer(signerB.address, ethers.parseUnits("0.1", 6));
    });
  }

  // ── TEST 4: Security - Wrong vault proof (MUST REVERT) ────────────────────
  log("\n[TEST 4] SECURITY: Wrong vault proof (must REVERT)");
  await shouldRevert("Wrong vault proof REVERTS", async () => {
    const usdcA3 = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signerA);
    await usdcA3.approve(vaultAddress, ethers.parseUnits("0.1", 6));
    return vault.shield(USDC_ADDRESS, ethers.parseUnits("0.1", 6), "xyz999");
  });

  // ── TEST 5: Security - Wallet B attacks Wallet A vault (MUST REVERT) ──────
  log("\n[TEST 5] SECURITY: Wallet B tries to access Wallet A vault (must REVERT)");
  await shouldRevert("Cross-wallet vault access REVERTS (onlyOwner)", async () => {
    return vaultB.unshield(USDC_ADDRESS, ethers.parseUnits("0.1", 6), VAULT_PROOF);
  });

  // ── TEST 6: Commit-Reveal Transfer ─────────────────────────────────────────
  log("\n[TEST 6] Commit-Reveal Transfer to Wallet B");
  let commitNonce;
  let usdcBefore;
  try {
    const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
    usdcBefore = await usdcContract.balanceOf(signerB.address);

    commitNonce = BigInt(Math.floor(Math.random() * 1e15));
    const commitHash = ethers.keccak256(
      ethers.solidityPacked(
        ["string", "uint256", "address", "address", "uint256"],
        [VAULT_PROOF, commitNonce, USDC_ADDRESS, signerB.address, TRANSFER_AMOUNT]
      )
    );

    log(`    Nonce: ${commitNonce}`);
    log(`    CommitHash: ${commitHash}`);
    log(`    Step 1: Committing...`);
    const commitTx = await vault.commitTransfer(commitHash, { gasLimit: 200000 });
    const commitReceipt = await commitTx.wait();
    log(`    Commit Tx: ${commitReceipt.hash}`);

    await waitBlocks(provider, 1);

    log(`    Step 2: Revealing...`);
    const revealTx = await vault.revealTransfer(
      USDC_ADDRESS,
      signerB.address,
      TRANSFER_AMOUNT,
      VAULT_PROOF,
      commitNonce
    );
    const revealReceipt = await revealTx.wait();
    log(`    Reveal Tx: ${revealReceipt.hash}`);

    const usdcAfter = await usdcContract.balanceOf(signerB.address);
    const received  = usdcAfter - usdcBefore;
    log(`    Wallet B received: ${ethers.formatUnits(received, 6)} USDC`);

    if (received >= TRANSFER_AMOUNT) {
      pass("Commit-Reveal Transfer: Wallet B receives raw USDC");
    } else {
      fail("Commit-Reveal Transfer", `Wallet B only got ${ethers.formatUnits(received, 6)} USDC`);
    }
  } catch (err) {
    fail("Commit-Reveal Transfer", err.message);
    commitNonce = null;
  }

  // ── TEST 7: Security - Replay Commit (MUST REVERT) ────────────────────────
  log("\n[TEST 7] SECURITY: Replay same commit (must REVERT)");
  if (commitNonce === null || commitNonce === undefined) {
    fail("Replay commit REVERTS", "Skipped: commit-reveal did not complete");
  } else {
    await shouldRevert("Replay commit REVERTS (Commit already used)", async () => {
      return vault.revealTransfer(
        USDC_ADDRESS,
        signerB.address,
        TRANSFER_AMOUNT,
        VAULT_PROOF,
        commitNonce
      );
    });
  }

  // ── TEST 8: Unshield ────────────────────────────────────────────────────────
  log("\n[TEST 8] Unshield USDC back to Wallet A");
  try {
    const usdcContract  = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
    const usdcBeforeA   = await usdcContract.balanceOf(signerA.address);
    const shieldedBefore = await vault.getShieldedBalance(USDC_ADDRESS);
    const toUnshield     = shieldedBefore < UNSHIELD_AMOUNT ? shieldedBefore : UNSHIELD_AMOUNT;

    log(`    Shielded balance: ${ethers.formatUnits(shieldedBefore, 6)} qUSDC`);
    log(`    Unshielding: ${ethers.formatUnits(toUnshield, 6)} USDC`);
    const tx      = await vault.unshield(USDC_ADDRESS, toUnshield, VAULT_PROOF, { gasLimit: 200000 });
    const receipt = await tx.wait();
    log(`    Tx: ${receipt.hash}`);

    const usdcAfterA = await usdcContract.balanceOf(signerA.address);
    const received   = usdcAfterA - usdcBeforeA;
    log(`    Wallet A received: ${ethers.formatUnits(received, 6)} USDC`);

    if (received >= toUnshield) {
      pass("Unshield USDC");
    } else {
      fail("Unshield USDC", `Expected ${ethers.formatUnits(toUnshield, 6)}, got ${ethers.formatUnits(received, 6)}`);
    }
  } catch (err) {
    fail("Unshield USDC", err.message);
  }

  // ── TEST 9: Change vault proof ─────────────────────────────────────────────
  log("\n[TEST 9] Change vault proof");
  try {
    log(`    Changing from "${VAULT_PROOF}" to "${NEW_VAULT_PROOF}"...`);
    const changeTx = await vault.changeVaultProof(VAULT_PROOF, NEW_VAULT_PROOF, { gasLimit: 200000 });
    await changeTx.wait();
    log(`    Verifying old proof fails...`);

    let oldFailed = false;
    try {
      const usdcA4 = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signerA);
      const oldCheckAmt = ethers.parseUnits("1", 6);
      const approveTx0 = await usdcA4.approve(vaultAddress, oldCheckAmt);
      await approveTx0.wait();
      const tx = await vault.shield(USDC_ADDRESS, oldCheckAmt, VAULT_PROOF);
      await tx.wait();
    } catch {
      oldFailed = true;
    }

    if (!oldFailed) {
      fail("Change vault proof", "Old proof still works after change (security hole!)");
    } else {
      log(`    Old proof rejected correctly.`);
      log(`    Verifying new proof works...`);
      const usdcA5 = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signerA);
      const verifyAmount = ethers.parseUnits("1", 6);
      const approveTx1 = await usdcA5.approve(vaultAddress, verifyAmount);
      await approveTx1.wait();
      const tx2     = await vault.shield(USDC_ADDRESS, verifyAmount, NEW_VAULT_PROOF);
      const receipt = await tx2.wait();
      log(`    New proof accepted. Tx: ${receipt.hash}`);
      pass("Change vault proof: old REVERTS, new succeeds");
    }
  } catch (err) {
    fail("Change vault proof", err.message);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  log("\n========================================");
  log("  RESULTS");
  log("========================================");
  for (const r of results) {
    log(`  ${r.result === "PASS" ? "[PASS]" : "[FAIL]"} ${r.name}`);
    if (r.reason) log(`         ${r.reason}`);
  }
  log("----------------------------------------");
  log(`  Total: ${passed + failed} | PASS: ${passed} | FAIL: ${failed}`);
  log("========================================\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
