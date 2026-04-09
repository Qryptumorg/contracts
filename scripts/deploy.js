const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying with account:", deployer.address);
    console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

    const network = await ethers.provider.getNetwork();
    console.log("Network:", network.name, "(chainId:", network.chainId.toString() + ")");
    console.log("");

    const QryptSafe = await ethers.getContractFactory("QryptSafe");
    const factory = await QryptSafe.deploy();
    await factory.waitForDeployment();

    const factoryAddress = await factory.getAddress();
    const implAddress = await factory.vaultImplementation();

    console.log("QryptSafe (factory) deployed to:", factoryAddress);
    console.log("PersonalQryptSafe implementation:", implAddress);
    console.log("");
    console.log("Set these env vars in your frontend:");
    if (network.chainId === 11155111n) {
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
