/**
 * Export ShieldToken standard JSON input for auto-verify service.
 * Run after every `npx hardhat compile`:
 *   node scripts/export-verify-input.js
 *
 * Writes: artifacts/api-server/verify-inputs/shield-token.json
 */

const fs = require("fs");
const path = require("path");

const BUILD_INFO_DIR = path.join(__dirname, "../artifacts/build-info");
const OUT_DIR = path.join(__dirname, "../../api-server/verify-inputs");
const OUT_FILE = path.join(OUT_DIR, "shield-token.json");

function main() {
    const files = fs.readdirSync(BUILD_INFO_DIR).filter((f) => f.endsWith(".json"));
    if (files.length === 0) {
        throw new Error("No build-info files found. Run: npx hardhat compile");
    }

    // Find a build-info that contains ShieldToken
    let found = null;
    for (const f of files) {
        const data = JSON.parse(fs.readFileSync(path.join(BUILD_INFO_DIR, f), "utf8"));
        if (Object.keys(data.input.sources).some((s) => s.includes("ShieldToken"))) {
            found = data;
            break;
        }
    }

    if (!found) {
        throw new Error("ShieldToken not found in any build-info. Run: npx hardhat compile");
    }

    if (!fs.existsSync(OUT_DIR)) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
    }

    // Save full standard JSON input
    fs.writeFileSync(OUT_FILE, JSON.stringify(found.input), "utf8");
    console.log("Exported ShieldToken verify input to:", OUT_FILE);
}

main();
