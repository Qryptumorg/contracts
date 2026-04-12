const { ethers } = require("hardhat");

const FACTORY = "0xD778C6f4F85Da972a373bA7A4e3B01476F3F6364";
const ETHERSCAN = "https://sepolia.etherscan.io";

const VAULT_PROOF = "abc123";

async function link(type, hash) {
    return `${ETHERSCAN}/${type}/${hash}`;
}

async function main() {
    const [wallet] = await ethers.getSigners();
    const bal = await ethers.provider.getBalance(wallet.address);
    console.log("Wallet:", wallet.address);
    console.log("Balance:", ethers.formatEther(bal), "ETH");
    console.log("Factory:", FACTORY);
    console.log("");

    // --- Deploy a fresh MockERC20 test token ---
    console.log("=== 1. Deploying MockERC20 (qUSDC, 6 decimals) ===");
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("Test USDC", "tUSDC", 6);
    await usdc.waitForDeployment();
    const usdcAddr = await usdc.getAddress();
    console.log("tUSDC deployed:", usdcAddr);
    console.log("Etherscan:", await link("address", usdcAddr));

    const mintAmount = ethers.parseUnits("1000", 6);
    const mintTx = await usdc.mint(wallet.address, mintAmount);
    await mintTx.wait();
    console.log("Minted 1000 tUSDC to wallet");
    console.log("");

    // --- Create vault ---
    console.log("=== 2. Creating Qrypt-Safe vault ===");
    const factory = await ethers.getContractAt("QryptSafe", FACTORY);

    const hasVault = await factory.hasVault(wallet.address);
    let vaultAddr;

    if (hasVault) {
        vaultAddr = await factory.getVault(wallet.address);
        console.log("Vault already exists:", vaultAddr);
    } else {
        const passwordHash = ethers.keccak256(ethers.toUtf8Bytes(VAULT_PROOF));
        const createTx = await factory.createVault(passwordHash);
        const receipt = await createTx.wait();
        vaultAddr = await factory.getVault(wallet.address);
        console.log("Vault created:", vaultAddr);
        console.log("Tx:", await link("tx", createTx.hash));
    }
    console.log("");

    const vault = await ethers.getContractAt("PersonalQryptSafe", vaultAddr);

    // --- Approve + Shield ---
    console.log("=== 3. Approving vault to spend 500 tUSDC ===");
    const shieldAmount = ethers.parseUnits("500", 6);
    const approveTx = await usdc.approve(vaultAddr, shieldAmount);
    await approveTx.wait();
    console.log("Approved. Tx:", await link("tx", approveTx.hash));

    console.log("\n=== 4. Shielding 500 tUSDC into vault ===");
    const shieldTx = await vault.shield(usdcAddr, shieldAmount, VAULT_PROOF);
    await shieldTx.wait();
    console.log("Shielded! Tx:", await link("tx", shieldTx.hash));

    // --- Check shielded balance ---
    const shieldedBal = await vault.getShieldedBalance(usdcAddr);
    const qTokenAddr = await vault.getQTokenAddress(usdcAddr);
    console.log("Shielded balance:", ethers.formatUnits(shieldedBal, 6), "tUSDC");
    console.log("qToken address:", qTokenAddr);
    const walletUSDCBefore = await usdc.balanceOf(wallet.address);
    console.log("Wallet tUSDC balance now:", ethers.formatUnits(walletUSDCBefore, 6));
    console.log("");

    // --- Unshield ---
    console.log("=== 5. Unshielding 200 tUSDC back to wallet ===");
    const unshieldAmount = ethers.parseUnits("200", 6);
    const unshieldTx = await vault.unshield(usdcAddr, unshieldAmount, VAULT_PROOF);
    await unshieldTx.wait();
    console.log("Unshielded! Tx:", await link("tx", unshieldTx.hash));

    const shieldedAfter = await vault.getShieldedBalance(usdcAddr);
    const walletUSDCAfter = await usdc.balanceOf(wallet.address);
    console.log("Shielded balance after:", ethers.formatUnits(shieldedAfter, 6), "tUSDC");
    console.log("Wallet tUSDC balance after:", ethers.formatUnits(walletUSDCAfter, 6));
    console.log("");

    // --- Commit + Reveal Transfer (send 100 tUSDC to a second address) ---
    console.log("=== 6. Commit-reveal transfer (100 tUSDC to random recipient) ===");
    const recipient = ethers.Wallet.createRandom().address;
    const nonce = Date.now();
    const commitHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes32"],
            [ethers.keccak256(
                ethers.solidityPacked(
                    ["string", "uint256", "address", "address", "uint256"],
                    [VAULT_PROOF, nonce, usdcAddr, recipient, ethers.parseUnits("100", 6)]
                )
            )]
        )
    );

    const commitHashRaw = ethers.keccak256(
        ethers.solidityPacked(
            ["string", "uint256", "address", "address", "uint256"],
            [VAULT_PROOF, nonce, usdcAddr, recipient, ethers.parseUnits("100", 6)]
        )
    );

    const commitTx = await vault.commitTransfer(commitHashRaw);
    await commitTx.wait();
    console.log("Commit submitted. Tx:", await link("tx", commitTx.hash));
    console.log("Waiting for next block...");
    await new Promise(r => setTimeout(r, 15000));

    const revealTx = await vault.revealTransfer(
        usdcAddr,
        recipient,
        ethers.parseUnits("100", 6),
        VAULT_PROOF,
        nonce
    );
    await revealTx.wait();
    console.log("Reveal executed! Tx:", await link("tx", revealTx.hash));
    const recipientBal = await usdc.balanceOf(recipient);
    console.log("Recipient received:", ethers.formatUnits(recipientBal, 6), "tUSDC");
    console.log("");

    console.log("=== All tests passed ===");
    console.log("Vault:", await link("address", vaultAddr));
    console.log("Factory:", await link("address", FACTORY));
}

main().catch(e => { console.error("\n[FAIL]", e.message || e); process.exitCode = 1; });
