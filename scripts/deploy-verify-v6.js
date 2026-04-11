const { ethers } = require("hardhat");
const https = require("https");
const fs = require("fs");
const path = require("path");

// ── Etherscan API v2 ────────────────────────────────────────────────────────
async function etherscanPost(params) {
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams(params).toString();
        const opts = {
            hostname: "api.etherscan.io",
            path: "/v2/api?chainid=11155111",
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

async function etherscanGet(params) {
    return new Promise((resolve, reject) => {
        const qs = new URLSearchParams({ chainid: "11155111", ...params }).toString();
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
    for (const f of files) {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        const sources = Object.keys(data.input.sources);
        if (sources.some((s) => s.includes("QryptSafeV6"))) {
            return path.join(dir, f);
        }
    }
    throw new Error("Cannot find build-info containing QryptSafeV6. Run: npx hardhat compile");
}

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();

    console.log("=== QryptSafe v6 Deploy + MIT Verify ===");
    console.log("Deployer  :", deployer.address);
    console.log("Balance   :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
    console.log("Network   :", network.name, "(chainId:", network.chainId.toString() + ")");

    if (network.chainId !== 11155111n) {
        throw new Error("This script is for Sepolia only (chainId 11155111)");
    }

    // ── Deploy ────────────────────────────────────────────────────────────────
    const Factory = await ethers.getContractFactory("contracts/QryptSafeV6.sol:QryptSafeV6");
    console.log("\nDeploying QryptSafe v6 factory...");
    const factory = await Factory.deploy();
    await factory.waitForDeployment();

    const factoryAddress = await factory.getAddress();
    const implAddress = await factory.vaultImplementation();

    console.log("QryptSafeV6 factory        :", factoryAddress);
    console.log("PersonalQryptSafeV6 impl   :", implAddress);

    // Wait for Etherscan to index the contracts
    console.log("\nWaiting 20 s for Etherscan to index new contracts...");
    await new Promise((r) => setTimeout(r, 20000));

    // ── Verify both contracts with MIT license ────────────────────────────────
    const buildInfoPath = await getBuildInfoPath();

    const factoryOk = await verifyWithMIT(
        factoryAddress,
        "contracts/QryptSafeV6.sol:QryptSafeV6",
        buildInfoPath,
        "QryptSafeV6 factory"
    );

    const implOk = await verifyWithMIT(
        implAddress,
        "contracts/PersonalQryptSafeV6.sol:PersonalQryptSafeV6",
        buildInfoPath,
        "PersonalQryptSafeV6 impl"
    );

    console.log("\n=== Summary ===");
    console.log("QryptSafeV6 factory        :", factoryAddress, factoryOk ? "VERIFIED MIT" : "UNVERIFIED");
    console.log("PersonalQryptSafeV6 impl   :", implAddress, implOk ? "VERIFIED MIT" : "UNVERIFIED");
    console.log("\nEtherscan links:");
    console.log("  Factory:", `https://sepolia.etherscan.io/address/${factoryAddress}#code`);
    console.log("  Impl   :", `https://sepolia.etherscan.io/address/${implAddress}#code`);
    console.log("\nNext steps:");
    console.log("  1. Update VITE_SHIELD_FACTORY_SEPOLIA secret to:", factoryAddress);
    console.log("  2. Update artifacts/shield-app/src/lib/wagmi.ts with the new factory address");
    console.log("  3. Update artifacts/shield-app/src/lib/abi.ts with V6 ABI");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
