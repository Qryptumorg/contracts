const { run } = require("hardhat");

async function main() {
    const factoryAddress = process.env.FACTORY_ADDRESS;
    if (!factoryAddress) {
        console.error("Error: FACTORY_ADDRESS env var is required");
        console.error("Usage: FACTORY_ADDRESS=0x... hardhat run scripts/verify.js --network sepolia");
        process.exitCode = 1;
        return;
    }

    console.log("Verifying ShieldFactory at:", factoryAddress);
    try {
        await run("verify:verify", {
            address: factoryAddress,
            constructorArguments: [],
        });
        console.log("ShieldFactory verified successfully");
    } catch (err) {
        if (err.message.includes("Already Verified")) {
            console.log("ShieldFactory already verified");
        } else {
            throw err;
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
