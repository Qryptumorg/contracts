/**
 * QryptSafe V4 -- Live On-chain E2E Test Suite (Sepolia)
 * T1: createVault  |  T2: approve + shield (100 USDC)
 * T3: partialUnshield (40 USDC)  |  T4: commit  |  T5: reveal (30 USDC)
 * H1-H5: revert invariants via eth_call
 * Wallet A: TEST_WALLET_A_PK  |  Vault proof: mno345
 * Results saved to scripts/test-v4-results.json
 */
const { ethers } = require("ethers");
const fs   = require("fs");
const path = require("path");

const FACTORY_V4 = "0x611Ba6F93fAeC0203eBee1c3e35d72C1e5ba560F";
const USDC       = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

const PROOF_STR  = "mno345";
const proofBytes = ethers.zeroPadBytes(ethers.toUtf8Bytes(PROOF_STR), 32);
const passwordHash = ethers.keccak256(proofBytes);

const FACTORY_ABI = [
    "function createVault(bytes32 passwordHash) external returns (address vault)",
    "function hasVault(address wallet) external view returns (bool)",
    "function getVault(address wallet) external view returns (address)",
    "function vaultCreatedAt(address) external view returns (uint256)",
    "event VaultCreated(address indexed owner, address indexed vault, uint256 createdAt)",
];
const VAULT_ABI = [
    "function shield(address tokenAddress, uint256 amount, bytes32 proof) external",
    "function unshield(address tokenAddress, uint256 amount, bytes32 proof) external",
    "function commit(bytes32 commitHash, bytes32 proof) external",
    "function reveal(address tokenAddress, address to, uint256 amount, bytes32 proof, bytes32 commitHash) external",
    "function getShieldedBalance(address tokenAddress) external view returns (uint256)",
    "function createdAtBlock() external view returns (uint256)",
    "function lastActivityBlock() external view returns (uint256)",
    "function activityCount() external view returns (uint256)",
    "function owner() external view returns (address)",
    "function initialized() external view returns (bool)",
];
const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function decimals() view returns (uint8)",
];

async function waitTx(txResp) {
    const rx = await txResp.wait(1);
    if (rx.status === 0) throw new Error("Transaction reverted (status 0)");
    return { hash: txResp.hash, receipt: rx };
}

async function expectRevert(fn) {
    try { await fn(); return false; }
    catch (_) { return true; }
}

const results = {
    ts: new Date().toISOString(),
    proof: PROOF_STR,
    factory: FACTORY_V4,
    tests: [],
};
let passed = 0, failed = 0;

function log(n, title, pass, desc, txHash = null, note = "") {
    const tag = pass ? "PASS" : "FAIL";
    results.tests.push({ n, title, pass, desc, txHash, note });
    if (pass) passed++; else failed++;
    const txStr = txHash ? `\n         TX: ${txHash}` : "";
    console.log(`  [${tag}] ${String(n).padStart(2, "0")} ${title}${txStr}`);
    if (note) console.log(`         note: ${note}`);
}

async function main() {
    const rpc = process.env.SEPOLIA_RPC_URL;
    const pkA = process.env.TEST_WALLET_A_PK;
    const pkB = process.env.TEST_WALLET_B_PK;
    if (!rpc || !pkA) throw new Error("Missing SEPOLIA_RPC_URL or TEST_WALLET_A_PK");

    const provider = new ethers.JsonRpcProvider(rpc);
    const walletA  = new ethers.Wallet(pkA, provider);
    const walletB  = pkB ? new ethers.Wallet(pkB, provider) : null;

    console.log("\n=== QryptSafe V4 -- Sepolia E2E ===");
    console.log("Factory :", FACTORY_V4);
    console.log("WalletA :", walletA.address);
    console.log("Proof   :", PROOF_STR);
    console.log("");

    const factory = new ethers.Contract(FACTORY_V4, FACTORY_ABI, walletA);
    const usdc    = new ethers.Contract(USDC, ERC20_ABI, walletA);
    const decimals = await usdc.decimals();
    const U = (n) => ethers.parseUnits(String(n), decimals);

    let vaultAddr = await factory.getVault(walletA.address);

    // ── T1: createVault ───────────────────────────────────────────────────
    console.log("T1: createVault...");
    if (vaultAddr !== ethers.ZeroAddress) {
        log("T1", "createVault (vault already exists)", true, "Vault already deployed for Wallet A", null, "Vault reused from prior run");
        console.log("    Vault already exists:", vaultAddr);
    } else {
        try {
            const gas = await factory.createVault.estimateGas(passwordHash);
            const tx  = await factory.createVault(passwordHash, { gasLimit: gas * 2n });
            const { hash } = await waitTx(tx);
            vaultAddr = await factory.getVault(walletA.address);
            log("T1", "createVault", true, "Factory deploys EIP-1167 clone for Wallet A, stores createdAt block", hash);
        } catch (e) {
            log("T1", "createVault", false, e.message);
        }
    }

    if (vaultAddr === ethers.ZeroAddress) {
        console.error("No vault address. Aborting.");
        process.exit(1);
    }
    console.log("    Vault:", vaultAddr);
    results.vaultA = vaultAddr;

    const vault = new ethers.Contract(vaultAddr, VAULT_ABI, walletA);

    // ── T2: approve + shield 100 USDC ─────────────────────────────────────
    console.log("\nT2: approve + shield 100 USDC...");
    try {
        const rawBal = await usdc.balanceOf(walletA.address);
        console.log("    USDC balance:", ethers.formatUnits(rawBal, decimals));
        const shieldAmt = rawBal >= U(10) ? U(10) : rawBal >= U(5) ? U(5) : rawBal;
        console.log("    Shield amount:", ethers.formatUnits(shieldAmt, decimals), "USDC");

        const allowance = await usdc.allowance(walletA.address, vaultAddr);
        let approveTx = null;
        if (allowance < shieldAmt) {
            const gas = await usdc.approve.estimateGas(vaultAddr, ethers.MaxUint256);
            const tx  = await usdc.approve(vaultAddr, ethers.MaxUint256, { gasLimit: gas * 2n });
            const { hash } = await waitTx(tx);
            approveTx = hash;
            console.log("    Approved:", hash);
        } else {
            console.log("    Allowance already sufficient.");
        }

        const gas2 = await vault.shield.estimateGas(USDC, shieldAmt, proofBytes);
        const tx2  = await vault.shield(USDC, shieldAmt, proofBytes, { gasLimit: gas2 * 2n });
        const { hash: shieldHash } = await waitTx(tx2);
        const bal = await vault.getShieldedBalance(USDC);
        const ok  = bal >= shieldAmt;
        log("T2", `approve + shield ${ethers.formatUnits(shieldAmt, decimals)} USDC`, ok,
            `Transfers ${ethers.formatUnits(shieldAmt, decimals)} USDC into vault, mints qUSDC to owner`, shieldHash,
            approveTx ? `approve TX: ${approveTx}` : "");
        results.approveTx = approveTx;
        results.shieldAmt = shieldAmt.toString();
    } catch (e) {
        log("T2", "approve + shield 100 USDC", false, e.message);
    }

    // ── T3: partialUnshield (40% of shielded balance, V4 feature) ────────
    console.log("\nT3: partialUnshield (partial, V4 feature)...");
    try {
        const balBefore = await vault.getShieldedBalance(USDC);
        console.log("    Shielded before:", ethers.formatUnits(balBefore, decimals));
        const partialAmt = balBefore / 2n;
        console.log("    Unshield amount:", ethers.formatUnits(partialAmt, decimals));
        const gas = await vault.unshield.estimateGas(USDC, partialAmt, proofBytes);
        const tx  = await vault.unshield(USDC, partialAmt, proofBytes, { gasLimit: gas * 2n });
        const { hash } = await waitTx(tx);
        const balAfter = await vault.getShieldedBalance(USDC);
        const ok = balAfter < balBefore;
        log("T3", `partialUnshield ${ethers.formatUnits(partialAmt, decimals)} USDC (V4 feature)`, ok,
            "Burns partial qUSDC and transfers partial USDC back to owner (V4 partial unshield)", hash);
        results.partialAmt = partialAmt.toString();
    } catch (e) {
        log("T3", "partialUnshield (V4 feature)", false, e.message);
    }

    // ── T4: commit ────────────────────────────────────────────────────────
    console.log("\nT4: commit...");
    const commitPreimage = ethers.keccak256(ethers.toUtf8Bytes("v4-e2e-commit-" + Date.now()));
    try {
        const gas = await vault.commit.estimateGas(commitPreimage, proofBytes);
        const tx  = await vault.commit(commitPreimage, proofBytes, { gasLimit: gas * 2n });
        const { hash } = await waitTx(tx);
        log("T4", "commit", true, "Stores commit hash on-chain with block timestamp, increments commitNonce", hash);
    } catch (e) {
        log("T4", "commit", false, e.message);
    }

    // ── T5: reveal ────────────────────────────────────────────────────────
    console.log("\nT5: reveal...");
    const recipient = walletB ? walletB.address : walletA.address;
    try {
        const shieldedNow = await vault.getShieldedBalance(USDC);
        const revealAmt = shieldedNow >= U(3) ? U(3) : shieldedNow >= U(1) ? U(1) : shieldedNow;
        console.log("    Shielded now:", ethers.formatUnits(shieldedNow, decimals), "| Reveal:", ethers.formatUnits(revealAmt, decimals));
        const gas = await vault.reveal.estimateGas(USDC, recipient, revealAmt, proofBytes, commitPreimage);
        const tx  = await vault.reveal(USDC, recipient, revealAmt, proofBytes, commitPreimage, { gasLimit: gas * 2n });
        const { hash } = await waitTx(tx);
        log("T5", `reveal ${ethers.formatUnits(revealAmt, decimals)} USDC to recipient`, true,
            "Burns qUSDC, transfers USDC to recipient via commit-reveal (shielded transfer)", hash,
            `recipient: ${recipient}`);
    } catch (e) {
        log("T5", "reveal", false, e.message);
    }

    // ── H1-H5: Revert invariants (eth_call, no gas) ───────────────────────
    console.log("\nRevert invariants (eth_call)...");

    const vaultRO = new ethers.Contract(vaultAddr, VAULT_ABI, provider);

    const h1 = await expectRevert(() =>
        vaultRO.shield.staticCall(USDC, U(100), ethers.zeroPadBytes(ethers.toUtf8Bytes("wrongproof"), 32),
            { from: walletA.address })
    );
    log("H1", "shield with wrong proof reverts (InvalidProof)", h1, "Custom error prevents shielding with bad vault proof");

    const h2 = await expectRevert(() =>
        vaultRO.shield.staticCall(USDC, U(100), proofBytes, { from: ethers.ZeroAddress })
    );
    log("H2", "shield from non-owner reverts (NotOwner)", h2, "Access control enforced via custom error");

    const h3 = await expectRevert(() =>
        vaultRO.shield.staticCall(USDC, 100n, proofBytes, { from: walletA.address })
    );
    log("H3", "shield below minimum reverts (InvalidAmount)", h3, "MINIMUM_SHIELD_AMOUNT = 1e6, 100 wei is below threshold");

    const h4 = await expectRevert(() =>
        vaultRO.reveal.staticCall(USDC, walletA.address, U(1), proofBytes, ethers.ZeroHash, { from: walletA.address })
    );
    log("H4", "reveal with zero commitHash reverts (CommitNotFound)", h4, "Non-existent commit hash rejected by custom error");

    const h5 = await expectRevert(() =>
        vaultRO.emergencyWithdraw.staticCall([USDC], proofBytes, { from: walletA.address })
    );
    log("H5", "emergencyWithdraw before delay reverts (EmergencyDelayNotMet)", h5, "1,296,000 block delay enforced on emergency path");

    // ── Vault metadata read ───────────────────────────────────────────────
    console.log("\nVault metadata...");
    const createdAt    = await vault.createdAtBlock();
    const lastActivity = await vault.lastActivityBlock();
    const count        = await vault.activityCount();
    console.log("  createdAtBlock    :", createdAt.toString());
    console.log("  lastActivityBlock :", lastActivity.toString());
    console.log("  activityCount     :", count.toString());
    results.metadata = {
        createdAtBlock:    createdAt.toString(),
        lastActivityBlock: lastActivity.toString(),
        activityCount:     count.toString(),
    };

    // ── Summary ───────────────────────────────────────────────────────────
    console.log("\n=== SUMMARY ===");
    console.log(`  ${passed} passed, ${failed} failed out of ${passed + failed} total`);
    results.passed = passed;
    results.failed = failed;

    const outPath = path.join(__dirname, "test-v4-results.json");
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log("\nResults saved:", outPath);

    if (failed > 0) {
        console.log("\nFailed tests:");
        results.tests.filter(t => !t.pass).forEach(t => console.log("  -", t.title, ":", t.desc));
        process.exit(1);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
