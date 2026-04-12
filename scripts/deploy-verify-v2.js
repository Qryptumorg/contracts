const hre = require("hardhat");

  async function main() {
      console.log("Deploying QryptSafeV2 to Sepolia...");
      const Factory = await hre.ethers.getContractFactory("QryptSafeV2");
      const factory = await Factory.deploy();
      await factory.waitForDeployment();
      const factoryAddr = await factory.getAddress();
      const implAddr = await factory.vaultImplementation();
      console.log("QryptSafeV2 (factory):", factoryAddr);
      console.log("PersonalQryptSafeV2 (impl):", implAddr);
      await factory.deploymentTransaction().wait(5);
      await hre.run("verify:verify", { address: factoryAddr, constructorArguments: [], license: "MIT" });
      await hre.run("verify:verify", { address: implAddr, constructorArguments: [], license: "MIT" });
      console.log("DONE. Update VITE_SHIELD_FACTORY_V2_SEPOLIA =", factoryAddr);
  }
  main().catch((e) => { console.error(e); process.exit(1); });
  