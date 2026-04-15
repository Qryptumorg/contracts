/**
 * Verify flattened source with explicit licenseType=3 (MIT)
 * Etherscan: https://etherscan.io/contract-license-types  →  3 = MIT
 */
const https = require("https");
const fs    = require("fs");

const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY;
if (!ETHERSCAN_KEY) { console.error("ETHERSCAN_API_KEY not set"); process.exit(1); }

const COMPILER = "v0.8.34+commit.80d5c536";

const TARGETS = [
  {
    address:      "0xF5F2866364cc1FCDEf766fEdb00B55441CEa7A15",
    contractName: "QryptSafeFactory",
    flatFile:     "/tmp/QryptSafeFactory_flat.sol",
  },
  {
    address:      "0xbb03D9505b108E2AAFCEC824A05Bc419836e564D",
    contractName: "QryptSafe",
    flatFile:     "/tmp/QryptSafe_flat.sol",
  },
];

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
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function pollGuid(guid) {
  for (let i = 0; i < 15; i++) {
    await sleep(8_000);
    const r = await post({ apikey: ETHERSCAN_KEY, module: "contract", action: "checkverifystatus", guid });
    console.log(`  [${i+1}/15] ${r.result}`);
    if (r.result && !r.result.startsWith("Pending")) return r.result;
  }
  return "timeout";
}

async function main() {
  for (const { address, contractName, flatFile } of TARGETS) {
    console.log("\n══════════════════════════════════════════════");
    console.log(`Contract : ${contractName}`);
    console.log(`Address  : ${address}`);

    const sourceCode = fs.readFileSync(flatFile, "utf8");

    const res = await post({
      apikey:          ETHERSCAN_KEY,
      module:          "contract",
      action:          "verifysourcecode",
      chainid:         "1",
      contractaddress: address,
      sourceCode,
      codeformat:      "solidity-single-file",
      contractname:    contractName,
      compilerversion: COMPILER,
      optimizationUsed:"1",
      runs:            "200",
      evmversion:      "paris",
      licenseType:     "3",       // ← MIT
    });

    console.log("Submit:", JSON.stringify(res));

    if (res.status === "1" && res.result) {
      const final = await pollGuid(res.result);
      console.log("Result:", final);
    } else {
      console.log("→ skipping poll (submit failed / already handled)");
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
