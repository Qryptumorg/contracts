/**
 * Re-submits verification to Etherscan with licenseType=3 (MIT) explicitly.
 * Etherscan license type IDs: https://etherscan.io/contract-license-types
 *   1=None, 2=Unlicense, 3=MIT, 4=GPL-2.0, 5=GPL-3.0 ...
 */
const https  = require("https");
const fs     = require("fs");
const path   = require("path");

const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY;
if (!ETHERSCAN_KEY) { console.error("ETHERSCAN_API_KEY not set"); process.exit(1); }

// Deployed addresses
const TARGETS = [
  {
    address:      "0xF5F2866364cc1FCDEf766fEdb00B55441CEa7A15",
    contractName: "contracts/QryptSafeFactory.sol:QryptSafeFactory",
  },
  {
    address:      "0xbb03D9505b108E2AAFCEC824A05Bc419836e564D",
    contractName: "contracts/QryptSafe.sol:QryptSafe",
  },
];

// Load build-info (Standard JSON Input + metadata)
const buildInfoDir = path.join(__dirname, "../artifacts-out/build-info");
const buildFile    = fs.readdirSync(buildInfoDir).find(f => f.endsWith(".json"));
if (!buildFile) { console.error("No build-info found. Run: npx hardhat compile"); process.exit(1); }

const buildInfo      = JSON.parse(fs.readFileSync(path.join(buildInfoDir, buildFile), "utf8"));
const solcVersion    = buildInfo.solcLongVersion; // e.g. "0.8.34+commit.xxxxxxxx"
const standardInput  = JSON.stringify(buildInfo.input);

function post(params) {
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
      res.on("end", () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function checkGuid(guid) {
  for (let i = 0; i < 12; i++) {
    await sleep(10_000);
    const r = await post({
      apikey: ETHERSCAN_KEY,
      module: "contract",
      action: "checkverifystatus",
      guid,
    });
    console.log(`  status check (${i + 1}/12):`, r.result);
    if (r.result && !r.result.startsWith("Pending")) return r.result;
  }
  return "timeout";
}

async function main() {
  console.log("Compiler version:", solcVersion);

  for (const { address, contractName } of TARGETS) {
    console.log("\n──────────────────────────────────────────────────");
    console.log("Verifying:", contractName, "@", address);

    const res = await post({
      apikey:          ETHERSCAN_KEY,
      module:          "contract",
      action:          "verifysourcecode",
      chainid:         "1",
      contractaddress: address,
      codeformat:      "solidity-standard-json-input",
      sourceCode:      standardInput,
      contractname:    contractName,
      compilerversion: `v${solcVersion}`,
      licenseType:     "3",           // ← MIT
    });

    console.log("Submit response:", JSON.stringify(res));

    if (res.status === "1" && res.result) {
      const final = await checkGuid(res.result);
      console.log("Final result:", final);
    } else {
      console.error("Submission failed:", res.message, res.result);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
