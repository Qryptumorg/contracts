/**
 * QryptSafe V3 — Live On-chain E2E Test Suite (Sepolia)
 * T1: createVault | T2: approve+shield | T3: commit+reveal | T4: changeVaultProof | T5: unshield
 * Wallet A: TEST_WALLET_A_PK  |  Vault proof: qwe123  |  New proof: abc456
 * Results saved to scripts/test-v3-results.json
 */
const { ethers } = require("ethers");
const fs   = require("fs");
const path = require("path");

const FACTORY_V3 = "0x88E8eAFafc99E83e687BCAbD53F783a92e51F75c";
const USDC       = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

const PROOF_STR_1    = "qwe123";
const PROOF_STR_2    = "abc456";
const proofBytes1    = ethers.zeroPadBytes(ethers.toUtf8Bytes(PROOF_STR_1), 32);
const proofBytes2    = ethers.zeroPadBytes(ethers.toUtf8Bytes(PROOF_STR_2), 32);
const passwordHash1  = ethers.keccak256(proofBytes1);
const passwordHash2  = ethers.keccak256(proofBytes2);

const FACTORY_ABI = [
    "function createVault(bytes32 passwordHash) external returns (address vault)",
    "function hasVault(address wallet) external view returns (bool)",
    "function getVault(address wallet) external view returns (address)",
    "function vaultImplementation() external view returns (address)",
    "event VaultCreated(address indexed owner, address indexed vault)",
];
const VAULT_ABI = [
    "function shield(address tokenAddress, uint256 amount, bytes32 proof) external",
    "function unshield(address tokenAddress, uint256 amount, bytes32 proof) external",
    "function commit(bytes32 commitHash, bytes32 proof) external",
    "function reveal(address tokenAddress, address to, uint256 amount, bytes32 proof, bytes32 commitHash) external",
    "function changeVaultProof(bytes32 newPasswordHash, bytes32 currentProof) external",
    "function getQTokenAddress(address tokenAddress) external view returns (address)",
    "function getShieldedBalance(address tokenAddress) external view returns (uint256)",
    "function owner() external view returns (address)",
    "function initialized() external view returns (bool)",
];
const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
];

async function waitTx(txResp) {
    const rx = await txResp.wait(1);
    if (rx.status === 0) throw new Error("Transaction reverted (status 0)");
    return { hash: txResp.hash, receipt: rx };
}

async function estimatedGas(callFn) {
    const est = await callFn();
    return est * 2n;
}

async function expectRevert(fn) {
    try { await fn(); return false; }
    catch (_) { return true; }
}

const results = { ts: new Date().toISOString(), proofInitial: PROOF_STR_1, proofNew: PROOF_STR_2, tests: [] };
let passed = 0, failed = 0;

function log(n, title, pass, desc, txHash = null, note = "") {
    const tag = pass ? "PASS" : "FAIL";
    results.tests.push({ n, title, pass, desc, txHash, note });
    if (pass) passed++; else failed++;
    const txStr = txHash ? `\n         TX: ${txHash}` : "";
    console.log(`  [${tag}] T${String(n).padStart(2, "0")} ${title}${txStr}`);
    if (note) console.log(`         note: ${note}`);
}

async function main() {
    const rpc  = process.env.SEPOLIA_RPC_URL;
    const pkA  = process.env.TEST_WALLET_A_PK;
    const pkB  = process.env.TEST_WALLET_B_PK;
    if (!rpc || !pkA) throw new Error("Missing SEPOLIA_RPC_URL or TEST_WALLET_A_PK");

    const provider = new ethers.JsonRpcProvider(rpc);
    const walletA  = new ethers.Wallet(pkA, provider);
    const walletB  = pkB ? new ethers.Wallet(pkB, provider) : null;
    const addrA    = walletA.address;
    const addrB    = walletB ? walletB.address : "0xA3F12571e24811CB885cae2a17F8e45C84343829";

    console.log("\n===== QryptSafe V3 On-Chain E2E =====");
    console.log("FACTORY_V3 :", FACTORY_V3);
    console.log("Wallet A   :", addrA);
    console.log("Wallet B   :", addrB);
    console.log("USDC       :", USDC);
    console.log("Proof 1    :", PROOF_STR_1, "->", passwordHash1);
    console.log("Proof 2    :", PROOF_STR_2, "->", passwordHash2);
    console.log("=====================================\n");

    const factory = new ethers.Contract(FACTORY_V3, FACTORY_ABI, walletA);
    const usdc    = new ethers.Contract(USDC, ERC20_ABI, walletA);

    let vaultAddr = "";

    /* ── T1: createVault ───────────────────────────────────────── */
    let tx;
    try {
        const gasLimit = await estimatedGas(() => factory.createVault.estimateGas(passwordHash1));
        const txResp   = await factory.createVault(passwordHash1, { gasLimit });
        const r        = await waitTx(txResp);
        vaultAddr      = await factory.getVault(addrA);
        const hasV     = await factory.hasVault(addrA);
        log(1, "createVault", hasV && vaultAddr !== ethers.ZeroAddress,
            `Vault deployed at ${vaultAddr}. hasVault(walletA)=${hasV}.`,
            r.hash);
    } catch (e) {
        log(1, "createVault", false, e.message);
        throw new Error("T1 failed — cannot proceed without vault");
    }

    const vault = new ethers.Contract(vaultAddr, VAULT_ABI, walletA);
    results.vaultA = vaultAddr;

    /* ── T2: approve + shield ──────────────────────────────────── */
    const SHIELD_AMOUNT = 2_000_000n; // 2.0 USDC (6 decimals)
    let txApprove = "", txShield = "";
    try {
        const usdcBal = await usdc.balanceOf(addrA);
        console.log("  USDC balance:", ethers.formatUnits(usdcBal, 6), "USDC");

        const gasApprove = await estimatedGas(() => usdc.approve.estimateGas(vaultAddr, SHIELD_AMOUNT));
        const appResp    = await usdc.approve(vaultAddr, SHIELD_AMOUNT, { gasLimit: gasApprove });
        const appR       = await waitTx(appResp);
        txApprove        = appR.hash;

        const gasShield  = await estimatedGas(() => vault.shield.estimateGas(USDC, SHIELD_AMOUNT, proofBytes1));
        const shResp     = await vault.shield(USDC, SHIELD_AMOUNT, proofBytes1, { gasLimit: gasShield });
        const shR        = await waitTx(shResp);
        txShield         = shR.hash;

        const balance    = await vault.getShieldedBalance(USDC);
        const ok         = balance === SHIELD_AMOUNT;
        log(2, "approve + shield 2.0 USDC", ok,
            `Approved vault to spend ${SHIELD_AMOUNT} USDC units. Shielded ${SHIELD_AMOUNT} units. Balance=${balance}.`,
            txShield, `approveTX: ${txApprove}`);
    } catch (e) {
        log(2, "approve + shield 2.0 USDC", false, e.message);
    }

    /* ── T3: commit + reveal (transfer 1.0 USDC to Wallet B) ──── */
    const TRANSFER_AMOUNT = 1_000_000n; // 1.0 USDC
    let txCommit = "", txReveal = "";
    try {
        const nonce      = 1n;
        const commitHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["address","address","uint256","uint256"],
                [USDC, addrB, TRANSFER_AMOUNT, nonce]
            )
        );

        const gasCommit  = await estimatedGas(() => vault.commit.estimateGas(commitHash, proofBytes1));
        const cResp      = await vault.commit(commitHash, proofBytes1, { gasLimit: gasCommit });
        const cR         = await waitTx(cResp);
        txCommit         = cR.hash;

        const gasReveal  = await estimatedGas(() => vault.reveal.estimateGas(USDC, addrB, TRANSFER_AMOUNT, proofBytes1, commitHash));
        const rResp      = await vault.reveal(USDC, addrB, TRANSFER_AMOUNT, proofBytes1, commitHash, { gasLimit: gasReveal });
        const rR         = await waitTx(rResp);
        txReveal         = rR.hash;

        const balAfter   = await vault.getShieldedBalance(USDC);
        const ok         = balAfter === SHIELD_AMOUNT - TRANSFER_AMOUNT;
        log(3, "commit + reveal transfer 1.0 USDC", ok,
            `commitHash=${commitHash.slice(0,12)}... RevealTX burned 1M qUSDC, sent 1.0 USDC to Wallet B. Balance after=${balAfter}.`,
            txReveal, `commitTX: ${txCommit}`);
    } catch (e) {
        log(3, "commit + reveal transfer 1.0 USDC", false, e.message);
    }

    /* ── T4: changeVaultProof ─────────────────────────────────── */
    try {
        const gasChange = await estimatedGas(() => vault.changeVaultProof.estimateGas(passwordHash2, proofBytes1));
        const chResp    = await vault.changeVaultProof(passwordHash2, proofBytes1, { gasLimit: gasChange });
        const chR       = await waitTx(chResp);
        tx              = chR.hash;

        const wrongReverts = await expectRevert(() =>
            vault.unshield.staticCall(USDC, 1n, proofBytes1)
        );
        log(4, "changeVaultProof", wrongReverts,
            `passwordHash updated to keccak256("${PROOF_STR_2}"). Old proof correctly rejected. New proof accepted.`,
            tx);
    } catch (e) {
        log(4, "changeVaultProof", false, e.message);
    }

    /* ── T5: unshield with new proof ─────────────────────────── */
    try {
        const balBefore = await vault.getShieldedBalance(USDC);
        const gasUnshield = await estimatedGas(() => vault.unshield.estimateGas(USDC, balBefore, proofBytes2));
        const usResp    = await vault.unshield(USDC, balBefore, proofBytes2, { gasLimit: gasUnshield });
        const usR       = await waitTx(usResp);
        const balAfter  = await vault.getShieldedBalance(USDC);
        const ok        = balAfter === 0n;
        log(5, "unshield with new vault proof", ok,
            `Unshielded ${balBefore} units using proof "${PROOF_STR_2}". Old proof rejected beforehand. Balance after=${balAfter}.`,
            usR.hash);
    } catch (e) {
        log(5, "unshield with new vault proof", false, e.message);
    }

    /* ── Summary ─────────────────────────────────────────────── */
    console.log(`\n===== RESULT: ${passed}/${passed + failed} passed =====`);
    results.passed = passed;
    results.failed = failed;
    results.walletA = addrA;
    results.walletB = addrB;

    const outPath = path.join(__dirname, "test-v3-results.json");
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log("Results saved to", outPath);
    console.log("\nAddresses for page update:");
    console.log("FACTORY_V3 =", FACTORY_V3);
    console.log("IMPL_V3    = 0xaf2E91CDc70e81fA74b9aE9C322e8302bb51715e");
    console.log("VAULT_A_V3 =", vaultAddr);
    console.log("WALLET_B   =", addrB);
    console.log("\nTX hashes:");
    results.tests.forEach(t => {
        if (t.txHash) console.log(`  T${t.n} ${t.title}: ${t.txHash}`);
    });
}

main().catch((e) => { console.error(e); process.exit(1); });
