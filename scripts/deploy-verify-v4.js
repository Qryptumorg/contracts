const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    const network = await hre.ethers.provider.getNetwork();

    console.log("=== QryptSafeV4 Deployment ===");
    console.log("Deployer :", deployer.address);
    console.log("Balance  :", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH");
    console.log("Network  :", network.name, "(chainId:", network.chainId.toString() + ")");
    console.log("");

    const Factory = await hre.ethers.getContractFactory("QryptSafeV4");
    console.log("Deploying QryptSafeV4 factory...");
    const factory = await Factory.deploy();
    await factory.waitForDeployment();

    const factoryAddr = await factory.getAddress();
    const implAddr    = await factory.vaultImplementation();

    console.log("QryptSafeV4 (factory)    :", factoryAddr);
    console.log("PersonalQryptSafeV4 (impl):", implAddr);
    console.log("");

    if (network.chainId === 11155111n) {
        console.log("Waiting 5 blocks for Etherscan indexing...");
        await factory.deploymentTransaction().wait(5);

        console.log("Verifying factory on Etherscan...");
        try {
            await hre.run("verify:verify", {
                address: factoryAddr,
                constructorArguments: [],
            });
            console.log("Factory verified.");
        } catch (e) {
            console.warn("Factory verify warning:", e.message);
        }

        console.log("Verifying impl on Etherscan...");
        try {
            await hre.run("verify:verify", {
                address: implAddr,
                constructorArguments: [],
            });
            console.log("Impl verified.");
        } catch (e) {
            console.warn("Impl verify warning:", e.message);
        }

        console.log("");
        console.log("=== DONE ===");
        console.log("FACTORY_V4 =", factoryAddr);
        console.log("IMPL_V4    =", implAddr);
        console.log("DEPLOY_TX  =", factory.deploymentTransaction().hash);
        console.log("");
        console.log("Next: fill these in SepoliaVerifiedV4Page.tsx");
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
