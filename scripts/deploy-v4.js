const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();

    console.log("=== QryptSafe v4 Deployment ===");
    console.log("Deployer  :", deployer.address);
    console.log("Balance   :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
    console.log("Network   :", network.name, "(chainId:", network.chainId.toString() + ")");
    console.log("");

    const QryptSafe = await ethers.getContractFactory("QryptSafe");
    console.log("Deploying QryptSafe factory (includes PersonalQryptSafe impl)...");
    const factory = await QryptSafe.deploy();
    await factory.waitForDeployment();

    const factoryAddress = await factory.getAddress();
    const implAddress    = await factory.vaultImplementation();

    console.log("QryptSafe factory deployed     :", factoryAddress);
    console.log("PersonalQryptSafe implementation:", implAddress);
    console.log("");

    if (network.chainId === 11155111n) {
        console.log("VITE_SHIELD_FACTORY_SEPOLIA=" + factoryAddress);
        console.log("");
        console.log("Update artifacts/shield-app/src/lib/appkit.ts:");
        console.log('  11155111: "' + factoryAddress + '",');
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
