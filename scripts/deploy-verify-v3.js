const hre = require("hardhat");

async function main() {
    console.log("Deploying QryptSafeV3 to Sepolia...");
    const Factory = await hre.ethers.getContractFactory("QryptSafeV3");
    const factory = await Factory.deploy();
    await factory.waitForDeployment();
    const factoryAddr = await factory.getAddress();
    const implAddr    = await factory.vaultImplementation();
    const deployTx    = factory.deploymentTransaction().hash;
    console.log("QryptSafeV3 (factory):", factoryAddr);
    console.log("PersonalQryptSafeV3 (impl):", implAddr);
    console.log("Deploy TX:", deployTx);
    console.log("Waiting 5 confirmations before verifying...");
    await factory.deploymentTransaction().wait(5);
    console.log("Verifying factory...");
    await hre.run("verify:verify", { address: factoryAddr, constructorArguments: [], license: "MIT" });
    console.log("Verifying impl...");
    await hre.run("verify:verify", { address: implAddr, constructorArguments: [], license: "MIT" });
    console.log("DONE.");
    console.log("FACTORY_V3 =", factoryAddr);
    console.log("IMPL_V3    =", implAddr);
    console.log("TX_DEPLOY  =", deployTx);
}
main().catch((e) => { console.error(e); process.exit(1); });
