const { ethers } = require("hardhat");
const https = require("https");
const fs = require("fs");
const path = require("path");

// ── Etherscan API v2 (mainnet chainId=1) ────────────────────────────────────
function etherscanPost(params) {
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams(params).toString();
        const opts = {
            hostname: "api.etherscan.io",
            path: "/v2/api?chainid=1",
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(body),
            },
        };
        const req = https.request(opts, (res) => {
            let d = "";
            res.on("data", (c) => (d += c));
            res.on("end", () => resolve(JSON.parse(d)));
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

function etherscanGet(params) {
    return new Promise((resolve, reject) => {
        const qs = new URLSearchParams({ chainid: "1", ...params }).toString();
        const opts = {
            hostname: "api.etherscan.io",
            path: `/v2/api?${qs}`,
            method: "GET",
        };
        const req = https.request(opts, (res) => {
            let d = "";
            res.on("data", (c) => (d += c));
            res.on("end", () => resolve(JSON.parse(d)));
        });
        req.on("error", reject);
        req.end();
    });
}

async function waitForVerification(guid, label) {
    for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 6000));
        const res = await etherscanGet({
            module: "contract",
            action: "checkverifystatus",
            guid,
            apikey: process.env.ETHERSCAN_API_KEY,
        });
        console.log(`  [${label}] status:`, res.result);
        if (res.result === "Pass - Verified") return true;
        if (res.result && res.result.startsWith("Fail")) {
            console.error("  Verification FAILED:", res.result);
            return false;
        }
    }
    console.error("  Timed out waiting for verification");
    return false;
}

async function verifyWithMIT(address, contractName, buildInfoPath, label) {
    const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, "utf8"));
    const standardJsonInput = JSON.stringify(buildInfo.input);

    console.log(`\nVerifying ${label} (${address}) with licenseType=3 (MIT)...`);

    const res = await etherscanPost({
        module: "contract",
        action: "verifysourcecode",
        apikey: process.env.ETHERSCAN_API_KEY,
        codeformat: "solidity-standard-json-input",
        contractname: contractName,
        contractaddress: address,
        compilerversion: "v0.8.34+commit.80d5c536",
        licenseType: "3",
        sourceCode: standardJsonInput,
        constructorArguments: "",
    });

    console.log("  Submit result:", res.status, res.message, res.result);

    if (res.status === "1" && res.result) {
        const ok = await waitForVerification(res.result, label);
        return ok;
    }
    return false;
}

async function getBuildInfoPath() {
    const dir = path.join(__dirname, "../artifacts/build-info");
    const files = fs.readdirSync(dir);
    // Look for build-info that contains the mainnet contracts (QryptSafe without V6 suffix)
    for (const f of files) {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        const sources = Object.keys(data.input.sources);
        // Must contain QryptSafe.sol but not be from V6 versioned file
        if (
            sources.some((s) => s === "contracts/QryptSafe.sol") &&
            sources.some((s) => s === "contracts/PersonalQryptSafe.sol")
        ) {
            return path.join(dir, f);
        }
    }
    throw new Error(
        "Cannot find build-info containing contracts/QryptSafe.sol. Run: npx hardhat compile"
    );
}

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();

    console.log("=== QryptSafe Mainnet Deploy + MIT Verify ===");
    console.log("Deployer  :", deployer.address);
    console.log("Balance   :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
    console.log("Network   :", network.name, "(chainId:", network.chainId.toString() + ")");

    if (network.chainId !== 1n) {
        throw new Error("This script is for Ethereum Mainnet only (chainId 1)");
    }

    const balanceWei = await ethers.provider.getBalance(deployer.address);
    if (balanceWei < ethers.parseEther("0.005")) {
        throw new Error(
            `Insufficient ETH balance. Have ${ethers.formatEther(balanceWei)} ETH, need at least 0.005 ETH`
        );
    }

    // ── Deploy ────────────────────────────────────────────────────────────────
    const Factory = await ethers.getContractFactory("contracts/QryptSafe.sol:QryptSafe");
    console.log("\nDeploying QryptSafe factory...");
    const factory = await Factory.deploy();
    await factory.waitForDeployment();

    const factoryAddress = await factory.getAddress();
    const implAddress = await factory.vaultImplementation();

    console.log("QryptSafe factory       :", factoryAddress);
    console.log("PersonalQryptSafe impl  :", implAddress);

    // Wait for Etherscan to index the contracts
    console.log("\nWaiting 30 s for Etherscan to index new contracts...");
    await new Promise((r) => setTimeout(r, 30000));

    // ── Verify both contracts with MIT license ────────────────────────────────
    const buildInfoPath = await getBuildInfoPath();

    const factoryOk = await verifyWithMIT(
        factoryAddress,
        "contracts/QryptSafe.sol:QryptSafe",
        buildInfoPath,
        "QryptSafe factory"
    );

    const implOk = await verifyWithMIT(
        implAddress,
        "contracts/PersonalQryptSafe.sol:PersonalQryptSafe",
        buildInfoPath,
        "PersonalQryptSafe impl"
    );

    console.log("\n=== Summary ===");
    console.log("QryptSafe factory       :", factoryAddress, factoryOk ? "VERIFIED MIT" : "UNVERIFIED");
    console.log("PersonalQryptSafe impl  :", implAddress, implOk ? "VERIFIED MIT" : "UNVERIFIED");
    console.log("\nEtherscan links:");
    console.log("  Factory:", `https://etherscan.io/address/${factoryAddress}#code`);
    console.log("  Impl   :", `https://etherscan.io/address/${implAddress}#code`);
    console.log("\nNote: All user vaults (PersonalQryptSafe clones) will automatically");
    console.log("      display as 'Minimal Proxy Contract' pointing to the verified impl.");
    console.log("\nNext steps:");
    console.log("  1. Set env var VITE_SHIELD_FACTORY_V1_MAINNET =", factoryAddress);
    console.log("  2. Set env var MAINNET_RPC_URL in API server secrets");
    console.log("  3. Restart API server to activate mainnet qToken auto-verify");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
