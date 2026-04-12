const { ethers } = require("hardhat");

const FACTORY    = "0xD778C6f4F85Da972a373bA7A4e3B01476F3F6364";
const USDC_ADDR  = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const ETHERSCAN  = "https://sepolia.etherscan.io";

const PASS_INIT  = "abc123";
const PASS_NEW   = "xyz789";
const PASS_WRONG = "aaa111";

const USDC_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function balanceOf(address account) external view returns (uint256)",
    "function allowance(address owner, address spender) external view returns (uint256)",
];

const results = [];

function log(label, status, detail = "") {
    const icon = status === "PASS" ? "PASS" : status === "FAIL" ? "FAIL" : "INFO";
    results.push({ label, status, detail });
    console.log(`[${icon}] ${label}${detail ? " -- " + detail : ""}`);
}

async function expectRevert(label, fn, expectedMsg) {
    try {
        const tx = await fn();
        if (tx && tx.wait) await tx.wait();
        log(label, "FAIL", `Expected revert "${expectedMsg}" but tx succeeded`);
    } catch (e) {
        const msg = e.message || "";
        if (msg.includes(expectedMsg)) {
            log(label, "PASS", `Reverted: "${expectedMsg}"`);
        } else {
            const short = msg.slice(0, 120).replace(/\n/g, " ");
            log(label, "FAIL", `Wrong revert: ${short}`);
        }
    }
}

async function main() {
    const provider = ethers.provider;

    const walletA = new ethers.Wallet(process.env.TEST_WALLET_A_PK, provider);
    const walletB = new ethers.Wallet(process.env.TEST_WALLET_B_PK, provider);

    console.log("=".repeat(60));
    console.log("WALLET_A:", walletA.address);
    console.log("WALLET_B:", walletB.address);
    console.log("Factory: ", FACTORY);
    console.log("=".repeat(60));

    const ethA = await provider.getBalance(walletA.address);
    const ethB = await provider.getBalance(walletB.address);
    console.log(`ETH_A: ${ethers.formatEther(ethA)} | ETH_B: ${ethers.formatEther(ethB)}`);

    const usdc = new ethers.Contract(USDC_ADDR, USDC_ABI, walletA);
    const usdcB = await usdc.balanceOf(walletA.address);
    console.log(`USDC_A: ${ethers.formatUnits(usdcB, 6)}`);
    console.log("");

    const factory = await ethers.getContractAt("QryptSafe", FACTORY, walletA);

    // ────────────────────────────────────────────────────────────────
    // T1 — Create vault
    // ────────────────────────────────────────────────────────────────
    console.log("--- T1: Create vault ---");
    const alreadyHas = await factory.hasVault(walletA.address);
    let vaultAddr;
    if (alreadyHas) {
        vaultAddr = await factory.getVault(walletA.address);
        log("T1 - Create vault", "INFO", `Vault already exists: ${vaultAddr}`);
    } else {
        const hash = ethers.keccak256(ethers.toUtf8Bytes(PASS_INIT));
        const tx = await factory.createVault(hash);
        const receipt = await tx.wait();
        vaultAddr = await factory.getVault(walletA.address);
        log("T1 - Create vault", "PASS", `${vaultAddr} | tx: ${ETHERSCAN}/tx/${tx.hash}`);
    }

    const hasNow = await factory.hasVault(walletA.address);
    log("T1 - hasVault() == true", hasNow ? "PASS" : "FAIL", hasNow.toString());

    const vault  = await ethers.getContractAt("PersonalQryptSafe", vaultAddr, walletA);
    const vaultB = await ethers.getContractAt("PersonalQryptSafe", vaultAddr, walletB);
    console.log("");

    // ────────────────────────────────────────────────────────────────
    // H1 — Shield dengan password salah
    // ────────────────────────────────────────────────────────────────
    console.log("--- H1: Shield with wrong password ---");
    await expectRevert(
        "H1 - Shield wrong password",
        () => vault.shield(USDC_ADDR, 1000000n, PASS_WRONG),
        "Invalid vault proof"
    );
    console.log("");

    // ────────────────────────────────────────────────────────────────
    // H2 — Create vault dua kali
    // ────────────────────────────────────────────────────────────────
    console.log("--- H2: Create vault twice ---");
    const hash2 = ethers.keccak256(ethers.toUtf8Bytes(PASS_INIT));
    await expectRevert(
        "H2 - Double createVault",
        () => factory.createVault(hash2),
        "Qrypt-Safe already exists for this wallet"
    );
    console.log("");

    // ────────────────────────────────────────────────────────────────
    // H3 — WALLET_B coba shield di vault WALLET_A
    // ────────────────────────────────────────────────────────────────
    console.log("--- H3: Non-owner tries to shield ---");
    await expectRevert(
        "H3 - Non-owner shield",
        () => vaultB.shield(USDC_ADDR, 1000000n, PASS_INIT),
        "Not vault owner"
    );
    console.log("");

    // ────────────────────────────────────────────────────────────────
    // H6 — Re-initialize vault
    // ────────────────────────────────────────────────────────────────
    console.log("--- H6: Re-initialize vault ---");
    const fakeHash = ethers.keccak256(ethers.toUtf8Bytes("zzz999"));
    await expectRevert(
        "H6 - Re-initialize",
        () => vault.initialize(walletB.address, fakeHash),
        "Already initialized"
    );
    console.log("");

    // ────────────────────────────────────────────────────────────────
    // H7 — Emergency withdraw sebelum waktunya
    // ────────────────────────────────────────────────────────────────
    console.log("--- H7: Emergency withdraw too early ---");
    await expectRevert(
        "H7 - Emergency withdraw early",
        () => vault.emergencyWithdraw([USDC_ADDR]),
        "Emergency withdraw not yet available"
    );
    console.log("");

    // ────────────────────────────────────────────────────────────────
    // H8 — Ganti password tanpa tahu password lama
    // ────────────────────────────────────────────────────────────────
    console.log("--- H8: Change proof with wrong old password ---");
    await expectRevert(
        "H8 - changeVaultProof wrong old password",
        () => vault.changeVaultProof(PASS_WRONG, PASS_NEW),
        "Invalid current vault proof"
    );
    console.log("");

    // ────────────────────────────────────────────────────────────────
    // H9 — Format password baru yang salah
    // ────────────────────────────────────────────────────────────────
    console.log("--- H9: Change proof with invalid new format ---");
    await expectRevert(
        "H9 - changeVaultProof invalid new format (too long)",
        () => vault.changeVaultProof(PASS_INIT, "toolongpassword"),
        "Invalid vault proof format"
    );
    await expectRevert(
        "H9b - changeVaultProof invalid new format (all digits)",
        () => vault.changeVaultProof(PASS_INIT, "123456"),
        "Invalid vault proof format"
    );
    await expectRevert(
        "H9c - changeVaultProof invalid new format (all letters)",
        () => vault.changeVaultProof(PASS_INIT, "abcdef"),
        "Invalid vault proof format"
    );
    console.log("");

    // ────────────────────────────────────────────────────────────────
    // T2 — Shield 2 USDC
    // ────────────────────────────────────────────────────────────────
    console.log("--- T2: Shield 2 USDC ---");
    const balBefore = await usdc.balanceOf(walletA.address);
    console.log(`  USDC balance before: ${ethers.formatUnits(balBefore, 6)}`);

    const approveTx = await usdc.approve(vaultAddr, 2000000n);
    await approveTx.wait();
    log("T2 - approve(vault, 2 USDC)", "PASS", `tx: ${ETHERSCAN}/tx/${approveTx.hash}`);

    const shieldTx = await vault.shield(USDC_ADDR, 2000000n, PASS_INIT);
    await shieldTx.wait();
    log("T2 - shield(USDC, 2_000_000)", "PASS", `tx: ${ETHERSCAN}/tx/${shieldTx.hash}`);

    const shieldedBal = await vault.getShieldedBalance(USDC_ADDR);
    const qTokenAddr  = await vault.getQTokenAddress(USDC_ADDR);
    const balAfter    = await usdc.balanceOf(walletA.address);
    log("T2 - shieldedBalance == 2 USDC", shieldedBal === 2000000n ? "PASS" : "FAIL",
        `${ethers.formatUnits(shieldedBal, 6)} qUSDC`);
    log("T2 - qUSDC token deployed", qTokenAddr !== ethers.ZeroAddress ? "PASS" : "FAIL",
        qTokenAddr);
    log("T2 - wallet USDC decreased", balAfter < balBefore ? "PASS" : "FAIL",
        `${ethers.formatUnits(balBefore, 6)} → ${ethers.formatUnits(balAfter, 6)}`);
    console.log("");

    // ────────────────────────────────────────────────────────────────
    // H5 — Reveal tanpa commit
    // ────────────────────────────────────────────────────────────────
    console.log("--- H5: Reveal without commit ---");
    const fakeNonce = 9999999999;
    await expectRevert(
        "H5 - revealTransfer without commit",
        () => vault.revealTransfer(USDC_ADDR, walletB.address, 1000000n, PASS_INIT, fakeNonce),
        "Commit not found"
    );
    console.log("");

    // ────────────────────────────────────────────────────────────────
    // T3 — Commit-reveal transfer 1 USDC ke WALLET_B
    // ────────────────────────────────────────────────────────────────
    console.log("--- T3: Commit-reveal transfer 1 USDC to WALLET_B ---");
    const usdcBbefore = await usdc.balanceOf(walletB.address);
    const nonce = Date.now();
    const transferAmount = 1000000n;

    const commitHashRaw = ethers.keccak256(
        ethers.solidityPacked(
            ["string", "uint256", "address", "address", "uint256"],
            [PASS_INIT, nonce, USDC_ADDR, walletB.address, transferAmount]
        )
    );

    const commitTx = await vault.commitTransfer(commitHashRaw);
    await commitTx.wait();
    log("T3 - commitTransfer", "PASS", `tx: ${ETHERSCAN}/tx/${commitTx.hash}`);

    console.log("  Waiting for next block (~15s)...");
    await new Promise(r => setTimeout(r, 16000));

    const revealTx = await vault.revealTransfer(
        USDC_ADDR, walletB.address, transferAmount, PASS_INIT, nonce
    );
    await revealTx.wait();
    log("T3 - revealTransfer", "PASS", `tx: ${ETHERSCAN}/tx/${revealTx.hash}`);

    const usdcBafter     = await usdc.balanceOf(walletB.address);
    const shieldedAfterT3 = await vault.getShieldedBalance(USDC_ADDR);
    log("T3 - WALLET_B received 1 USDC", usdcBafter > usdcBbefore ? "PASS" : "FAIL",
        `${ethers.formatUnits(usdcBbefore, 6)} → ${ethers.formatUnits(usdcBafter, 6)}`);
    log("T3 - shieldedBalance == 1 USDC", shieldedAfterT3 === 1000000n ? "PASS" : "FAIL",
        ethers.formatUnits(shieldedAfterT3, 6));
    console.log("");

    // ────────────────────────────────────────────────────────────────
    // T4 — Ganti vault proof
    // ────────────────────────────────────────────────────────────────
    console.log("--- T4: Change vault proof abc123 -> xyz789 ---");
    const changeTx = await vault.changeVaultProof(PASS_INIT, PASS_NEW);
    await changeTx.wait();
    log("T4 - changeVaultProof(abc123, xyz789)", "PASS", `tx: ${ETHERSCAN}/tx/${changeTx.hash}`);
    console.log("");

    // ────────────────────────────────────────────────────────────────
    // H4 — Pakai password lama setelah ganti
    // ────────────────────────────────────────────────────────────────
    console.log("--- H4: Use old password after change ---");
    await expectRevert(
        "H4 - unshield with old password abc123",
        () => vault.unshield(USDC_ADDR, 500000n, PASS_INIT),
        "Invalid vault proof"
    );
    console.log("");

    // ────────────────────────────────────────────────────────────────
    // T5 — Unshield sisa 1 USDC dengan password baru
    // ────────────────────────────────────────────────────────────────
    console.log("--- T5: Unshield 1 USDC with new password ---");
    const walletABefore = await usdc.balanceOf(walletA.address);
    const unshieldTx = await vault.unshield(USDC_ADDR, 1000000n, PASS_NEW);
    await unshieldTx.wait();
    log("T5 - unshield(USDC, 1_000_000, xyz789)", "PASS", `tx: ${ETHERSCAN}/tx/${unshieldTx.hash}`);

    const walletAAfter   = await usdc.balanceOf(walletA.address);
    const shieldedFinal  = await vault.getShieldedBalance(USDC_ADDR);
    log("T5 - WALLET_A received USDC back", walletAAfter > walletABefore ? "PASS" : "FAIL",
        `${ethers.formatUnits(walletABefore, 6)} → ${ethers.formatUnits(walletAAfter, 6)}`);
    log("T5 - shieldedBalance == 0", shieldedFinal === 0n ? "PASS" : "FAIL",
        ethers.formatUnits(shieldedFinal, 6));
    console.log("");

    // ────────────────────────────────────────────────────────────────
    // FINAL REPORT
    // ────────────────────────────────────────────────────────────────
    console.log("=".repeat(60));
    console.log("FULL TEST REPORT");
    console.log("=".repeat(60));
    const passed = results.filter(r => r.status === "PASS").length;
    const failed = results.filter(r => r.status === "FAIL").length;
    const info   = results.filter(r => r.status === "INFO").length;

    results.forEach(r => {
        const icon = r.status === "PASS" ? "PASS" : r.status === "FAIL" ? "FAIL" : "INFO";
        console.log(`  [${icon}] ${r.label}`);
        if (r.detail) console.log(`         ${r.detail}`);
    });

    console.log("=".repeat(60));
    console.log(`PASSED: ${passed}  |  FAILED: ${failed}  |  INFO: ${info}`);
    console.log("=".repeat(60));
    console.log("Vault:   ", `${ETHERSCAN}/address/${vaultAddr}`);
    console.log("qUSDC:   ", `${ETHERSCAN}/address/${qTokenAddr}`);
    console.log("Factory: ", `${ETHERSCAN}/address/${FACTORY}`);
    console.log("=".repeat(60));

    if (failed > 0) process.exitCode = 1;
}

main().catch(e => {
    console.error("\n[FATAL]", e.message || e);
    process.exitCode = 1;
});
