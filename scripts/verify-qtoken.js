/**
 * Qryptum qToken Verifier
 * Verifies a ShieldToken (qToken) contract on Etherscan.
 *
 * Usage:
 *   QTOKEN_ADDRESS=0x... npx hardhat run scripts/verify-qtoken.js --network sepolia
 *   QTOKEN_ADDRESS=0x... npx hardhat run scripts/verify-qtoken.js --network mainnet
 *
 * The script reads name, symbol, vault, and decimals directly from the
 * deployed contract, then submits verification to Etherscan.
 */

const { ethers, run } = require("hardhat");

const QTOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function vault() view returns (address)",
  "function decimals() view returns (uint8)",
];

async function main() {
  const qTokenAddress = process.env.QTOKEN_ADDRESS;
  if (!qTokenAddress) {
    throw new Error("Set QTOKEN_ADDRESS env var to the qToken contract address");
  }

  const [signer] = await ethers.getSigners();
  const provider = signer.provider;
  const qToken = new ethers.Contract(qTokenAddress, QTOKEN_ABI, provider);

  const name     = await qToken.name();
  const symbol   = await qToken.symbol();
  const vault    = await qToken.vault();
  const decimals = await qToken.decimals();

  console.log("qToken address:", qTokenAddress);
  console.log("name:          ", name);
  console.log("symbol:        ", symbol);
  console.log("vault:         ", vault);
  console.log("decimals:      ", decimals);
  console.log("\nSubmitting to Etherscan...");

  await run("verify:verify", {
    address: qTokenAddress,
    contract: "contracts/ShieldToken.sol:ShieldToken",
    constructorArguments: [name, symbol, vault, decimals],
  });

  console.log("Verified:", `https://sepolia.etherscan.io/address/${qTokenAddress}#code`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
