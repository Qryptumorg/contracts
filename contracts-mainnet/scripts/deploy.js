const hre   = require("hardhat");
const https = require("https");
const fs    = require("fs");
const { execSync } = require("child_process");

// ── Etherscan helpers ─────────────────────────────────────────────────────────

function etherscanPost(params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const req  = https.request({
      hostname: "api.etherscan.io",
      path:     "/v2/api?chainid=1",
      method:   "POST",
      headers: {
        "Content-Type":   "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let d = "";
      res.on("data", c => (d += c));
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function pollGuid(guid, label) {
  for (let i = 0; i < 15; i++) {
    await sleep(8_000);
    const r = await etherscanPost({
      apikey: process.env.ETHERSCAN_API_KEY,
      module: "contract",
      action: "checkverifystatus",
      guid,
    });
    console.log(`  [${label}] ${i + 1}/15: ${r.result}`);
    if (r.result && !r.result.startsWith("Pending")) return r.result;
  }
  return "timeout";
}

async function verifyMIT(address, contractName, flatFile) {
  const src = fs.readFileSync(flatFile, "utf8");
  const res = await etherscanPost({
    apikey:          process.env.ETHERSCAN_API_KEY,
    module:          "contract",
    action:          "verifysourcecode",
    chainid:         "1",
    contractaddress: address,
    sourceCode:      src,
    codeformat:      "solidity-single-file",
    contractname:    contractName,
    compilerversion: "v0.8.34+commit.80d5c536",
    optimizationUsed:"1",
    runs:            "999",
    evmversion:      "paris",
    licenseType:     "3",   // MIT — https://etherscan.io/contract-license-types
  });
  console.log(`  submit [${contractName}]:`, JSON.stringify(res));
  if (res.status === "1" && res.result) {
    return await pollGuid(res.result, contractName);
  }
  return `failed: ${res.result}`;
}

function flatten(contractPath) {
  // Run hardhat flatten, strip duplicate SPDX lines, prepend single MIT header
  const raw = execSync(`npx hardhat flatten ${contractPath} 2>/dev/null`, { encoding: "utf8" });
  const stripped = raw
    .split("\n")
    .filter(l => !l.startsWith("// SPDX-License-Identifier:"))
    .join("\n");
  return "// SPDX-License-Identifier: MIT\n" + stripped;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deployer :", deployer.address);
  console.log("Balance  :", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("Network  :", hre.network.name, `(chainId ${hre.network.config.chainId})`);
  console.log("─────────────────────────────────────────────────────");

  // ── 1. Deploy ──────────────────────────────────────────────────────────────
  console.log("\n[1/3] Deploying QryptSafeFactory...");
  const Factory = await hre.ethers.getContractFactory("QryptSafeFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();

  const factoryAddress = await factory.getAddress();
  const implAddress    = await factory.qryptSafeImpl();

  console.log("  QryptSafeFactory :", factoryAddress);
  console.log("  QryptSafe impl   :", implAddress);

  // ── 2. Flatten ────────────────────────────────────────────────────────────
  console.log("\n[2/3] Flattening...");
  const factoryFlat = "/tmp/deploy_factory_flat.sol";
  const implFlat    = "/tmp/deploy_impl_flat.sol";
  fs.writeFileSync(factoryFlat, flatten("contracts/QryptSafeFactory.sol"));
  fs.writeFileSync(implFlat,    flatten("contracts/QryptSafe.sol"));
  console.log("  Done.");

  // ── 3. Verify with MIT ────────────────────────────────────────────────────
  if (!process.env.ETHERSCAN_API_KEY) {
    console.log("\n[3/3] No ETHERSCAN_API_KEY — skipping verification");
  } else {
    console.log("\n[3/3] Verifying with licenseType=3 (MIT)...");
    let r = await verifyMIT(factoryAddress, "QryptSafeFactory", factoryFlat);
    console.log("  Factory:", r);
    r = await verifyMIT(implAddress, "QryptSafe", implFlat);
    console.log("  Impl   :", r);
  }

  // ── Result ─────────────────────────────────────────────────────────────────
  console.log("\n═════════════════════════════════════════════════════");
  console.log("FACTORY :", factoryAddress);
  console.log("IMPL    :", implAddress);
  console.log("═════════════════════════════════════════════════════");
}

main().catch(e => { console.error(e); process.exit(1); });
