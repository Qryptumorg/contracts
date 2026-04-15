require("@nomicfoundation/hardhat-toolbox");

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";
const ETHERSCAN_API_KEY    = process.env.ETHERSCAN_API_KEY    || "";

// Public Ethereum mainnet RPC (no API key needed)
const MAINNET_RPC = "https://ethereum.publicnode.com";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.34",
    settings: {
      optimizer: {
        enabled: true,
        runs: 999,
      },
    },
  },
  networks: {
    mainnet: {
      url:      MAINNET_RPC,
      accounts: DEPLOYER_PRIVATE_KEY
        ? [DEPLOYER_PRIVATE_KEY.startsWith("0x") ? DEPLOYER_PRIVATE_KEY : `0x${DEPLOYER_PRIVATE_KEY}`]
        : [],
      chainId:  1,
    },
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
  },
  paths: {
    sources:   "./contracts",
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts-out",
  },
};
