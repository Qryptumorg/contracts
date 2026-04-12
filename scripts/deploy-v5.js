const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();

    console.log("=== QryptSafe v5 Deployment ===");
    console.log("Deployer  :", deployer.address);
    console.log("Balance   :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
    console.log("Network   :", network.name, "(chainId:", network.chainId.toString() + ")");
    console.log("");
    console.log("v5 changes:");
    console.log("  - All password params: string -> bytes32 (hash only, never raw)");
    console.log("  - Full function/event rename: qrypt/unqrypt/veilTransfer/unveilTransfer/railgun/rotateProof/claimAirVoucher");
    console.log("  - QryptSafe + QryptAir: same UX, passwords now hashed client-side");
    console.log("");

    const QryptSafe = await ethers.getContractFactory("contracts/QryptSafeV5.sol:QryptSafeV5");

    console.log("Deploying QryptSafe v5 factory (includes PersonalQryptSafe v5 impl)...");
    const factory = await QryptSafe.deploy();
    await factory.waitForDeployment();

    const factoryAddress = await factory.getAddress();
    const implAddress    = await factory.qryptSafeImpl();

    console.log("QryptSafe v5 factory deployed      :", factoryAddress);
    console.log("PersonalQryptSafe v5 implementation:", implAddress);
    console.log("");

    if (network.chainId === 11155111n) {
        console.log("Update artifacts/shield-app/src/lib/appkit.ts:");
        console.log('  11155111: "' + factoryAddress + '",');
        console.log("");
        console.log("VITE_SHIELD_FACTORY_SEPOLIA=" + factoryAddress);
    } else if (network.chainId === 1n) {
        console.log("VITE_SHIELD_FACTORY_MAINNET=" + factoryAddress);
    } else {
        console.log("VITE_SHIELD_FACTORY_ADDRESS=" + factoryAddress);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
