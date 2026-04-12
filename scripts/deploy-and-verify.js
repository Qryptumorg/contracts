const { ethers } = require("hardhat");
const https = require("https");
const qs = require("querystring");
const fs = require("fs");
const path = require("path");

const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY;
const COMPILER = "v0.8.34+commit.80d5c536";
const LICENSE_MIT = "3";

function etherscanPost(params) {
    return new Promise((resolve, reject) => {
        const body = qs.stringify(params);
        const req = https.request({
            hostname: "api.etherscan.io",
            path: "/v2/api?chainid=11155111",
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(body),
                "User-Agent": "qryptum-deploy/1.0",
            }
        }, res => {
            const d = [];
            res.on("data", c => d.push(c));
            res.on("end", () => {
                try { resolve(JSON.parse(Buffer.concat(d).toString())); }
                catch { resolve({ status: "0", result: Buffer.concat(d).toString().slice(0, 200) }); }
            });
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

function etherscanGet(params) {
    return new Promise((resolve, reject) => {
        const qs_str = qs.stringify({ ...params, chainid: "11155111" });
        const req = https.request({
            hostname: "api.etherscan.io",
            path: "/v2/api?" + qs_str,
            method: "GET",
            headers: { "User-Agent": "qryptum-deploy/1.0" }
        }, res => {
            const d = [];
            res.on("data", c => d.push(c));
            res.on("end", () => {
                try { resolve(JSON.parse(Buffer.concat(d).toString())); }
                catch { resolve({ status: "0" }); }
            });
        });
        req.on("error", reject);
        req.end();
    });
}

async function pollVerification(guid, label, maxWait = 90) {
    const deadline = Date.now() + maxWait * 1000;
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 6000));
        const res = await etherscanGet({
            module: "contract",
            action: "checkverifystatus",
            guid,
            apikey: ETHERSCAN_KEY,
        });
        console.log(`  [${label}] ${res.result}`);
        if (res.result === "Pass - Verified") return true;
        if (res.result && !res.result.toLowerCase().includes("pending")) return false;
    }
    return false;
}

function getLatestBuildInfo() {
    const dir = path.join(__dirname, "../artifacts/build-info");
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
    files.sort((a, b) => {
        const sa = fs.statSync(path.join(dir, a));
        const sb = fs.statSync(path.join(dir, b));
        return sb.mtimeMs - sa.mtimeMs;
    });
    if (!files.length) throw new Error("No build-info files found");
    const chosen = files[0];
    console.log("Using build-info:", chosen);
    return JSON.parse(fs.readFileSync(path.join(dir, chosen), "utf8"));
}

async function verifyStandardJSON(address, contractName, stdInputJSON) {
    console.log(`\nVerifying ${contractName} @ ${address} (Standard JSON, MIT)...`);
    const res = await etherscanPost({
        module: "contract",
        action: "verifysourcecode",
        contractaddress: address,
        sourceCode: stdInputJSON,
        codeformat: "solidity-standard-json-input",
        contractname: contractName,
        compilerversion: COMPILER,
        licenseType: LICENSE_MIT,
        apikey: ETHERSCAN_KEY,
    });
    console.log(`  Submit: status=${res.status} result=${res.result}`);
    if (res.status === "1") {
        return await pollVerification(res.result, contractName.split(":")[1]);
    }
    console.log(`  FAILED:`, res);
    return false;
}

async function confirmLicense(address) {
    const res = await etherscanGet({
        module: "contract",
        action: "getsourcecode",
        address,
        apikey: ETHERSCAN_KEY,
    });
    const r = res.result?.[0];
    return r ? `${r.ContractName} | License: ${r.LicenseType || "(empty)"}` : "not found";
}

async function main() {
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    console.log("Deploying with:", deployer.address);
    console.log("Balance:", (await ethers.provider.getBalance(deployer.address)).toString());
    console.log("Network:", network.name, "(chainId:", network.chainId.toString() + ")");
    console.log("");

    const QryptSafe = await ethers.getContractFactory("QryptSafe");
    const factory = await QryptSafe.deploy();
    const deployTx = factory.deploymentTransaction();
    await factory.waitForDeployment();

    const factoryAddress = await factory.getAddress();
    const implAddress = await factory.vaultImplementation();

    console.log("QryptSafe (factory) deployed to:", factoryAddress);
    console.log("PersonalQryptSafe implementation:", implAddress);
    console.log("Tx hash:", deployTx.hash);
    console.log("\nWaiting 5 confirmations before verification...");
    await deployTx.wait(5);
    console.log("5 confirmations received.");

    const buildInfo = getLatestBuildInfo();
    const stdInputJSON = JSON.stringify(buildInfo.input);
    console.log("Standard JSON size:", stdInputJSON.length, "bytes");

    const okFactory = await verifyStandardJSON(
        factoryAddress,
        "contracts/QryptSafe.sol:QryptSafe",
        stdInputJSON
    );
    const okImpl = await verifyStandardJSON(
        implAddress,
        "contracts/PersonalQryptSafe.sol:PersonalQryptSafe",
        stdInputJSON
    );

    console.log("\n=== Results ===");
    console.log("QryptSafe factory:", factoryAddress, okFactory ? "VERIFIED" : "FAILED");
    console.log("PersonalQryptSafe impl:", implAddress, okImpl ? "VERIFIED" : "FAILED");

    if (okFactory || okImpl) {
        await new Promise(r => setTimeout(r, 5000));
        console.log("\n=== License Confirmation ===");
        console.log("Factory:", await confirmLicense(factoryAddress));
        console.log("Impl:", await confirmLicense(implAddress));
    }

    console.log("\nEtherscan:");
    console.log(" ", `https://sepolia.etherscan.io/address/${factoryAddress}#code`);
    console.log(" ", `https://sepolia.etherscan.io/address/${implAddress}#code`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
